# 🚀 ETA-OTT Deployment Guide

## Architecture Overview

```
┌──────────────────────────────┐    ┌──────────────────────────────┐
│  EC2 Instance 1 — App Server │    │  EC2 Instance 2 — ML Server  │
│  t2.micro (1 GB RAM)         │    │  t2.micro (1 GB + 2GB Swap)  │
│                              │    │                              │
│  ┌────────────────────┐      │    │  ┌────────────────────┐      │
│  │ Nginx (:80)        │      │    │  │ ML Service (:8000) │      │
│  │ React SPA + Proxy  │      │    │  │ FastAPI + PyTorch  │      │
│  └────────┬───────────┘      │    │  └────────────────────┘      │
│           │ /api proxy       │    │                              │
│  ┌────────▼───────────┐      │    │  GitHub Runner (optional)    │
│  │ Backend (:5000)    │──────│───▶│                              │
│  │ Node.js + Express  │      │    │                              │
│  └────────────────────┘      │    │                              │
│                              │    │                              │
│  GitHub Self-Hosted Runner   │    │                              │
└──────────────────────────────┘    └──────────────────────────────┘
```

---

## 1. EC2 Instance Setup (Both Instances)

### Launch Instances
- **AMI**: Ubuntu 22.04 LTS
- **Type**: t2.micro
- **Region**: ap-south-1 (Mumbai)
- **Storage**: 30 GB gp3
- **VPC**: Same VPC & subnet (so they can talk via private IPs)
- **Key pair**: Create one and download the `.pem` file

### Security Groups

**Instance 1 (App Server):**

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP (Frontend) |
| 443 | TCP | 0.0.0.0/0 | HTTPS (future) |

**Instance 2 (ML Server):**

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Instance 1 SG | SSH (from App server) |
| 8000 | TCP | Instance 1 SG | ML API (from App server only) |

> ⚠️ **Important**: Instance 2 should NOT have ports open to the public. Only Instance 1 should be able to reach it.

### Install Docker (run on BOTH instances)

```bash
# SSH into the instance
ssh -i your-key.pem ubuntu@<instance-public-ip>

# Install Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### Create Swap File (Instance 2 only — for ML service)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h  # Verify swap is active
```

---

## 2. Setup SSH Between Instances

From **Instance 1**, generate an SSH key to access **Instance 2**:

```bash
# On Instance 1
ssh-keygen -t ed25519 -f ~/.ssh/ml_server_key -N ""
cat ~/.ssh/ml_server_key.pub
```

Copy the output and add it to **Instance 2**:

```bash
# On Instance 2
echo "<paste-public-key-here>" >> ~/.ssh/authorized_keys
```

Test the connection from Instance 1:

```bash
ssh -i ~/.ssh/ml_server_key ubuntu@<instance-2-private-ip>
```

---

## 3. Configure Environment Files

### Instance 1: Backend `.env`

```bash
# On Instance 1
mkdir -p ~/eta-ott/backend
nano ~/eta-ott/backend/.env
```

Paste your backend `.env` content exactly as in your local `.env`, but update:

```env
NODE_ENV=production
ML_SERVICE_URL=http://<instance-2-private-ip>:8000
ALLOWED_ORIGINS=http://<instance-1-public-ip>,https://yourdomain.com
```

### Instance 1: Frontend build args

These are passed as build args in `docker-compose.app.yml`. Create a `.env` file at the project root:

```bash
nano ~/eta-ott/.env
```

```env
VITE_FIREBASE_API_KEY=your_key_here
VITE_FIREBASE_AUTH_DOMAIN=etaott.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=etaott
VITE_FIREBASE_STORAGE_BUCKET=etaott.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
ML_SERVICE_URL=http://<instance-2-private-ip>:8000
```

---

## 4. Register GitHub Self-Hosted Runner

On **Instance 1**:

```bash
# Create runner directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download latest runner (check GitHub for current version)
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf actions-runner-linux-x64.tar.gz

# Configure (get token from: GitHub Repo → Settings → Actions → Runners → New self-hosted runner)
./config.sh --url https://github.com/<owner>/<repo> --token <YOUR_TOKEN>

# Install as system service (starts on boot)
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

---

## 5. Add GitHub Secrets

Go to **GitHub Repo → Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `ML_SERVER_HOST` | Private IP of Instance 2 (e.g., `10.0.1.25`) |
| `ML_SERVER_USER` | `ubuntu` |
| `ML_SERVER_SSH_KEY` | Content of `~/.ssh/ml_server_key` from Instance 1 |
| `VITE_FIREBASE_API_KEY` | Your Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | `etaott.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `etaott` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `etaott.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID |
| `VITE_FIREBASE_APP_ID` | Your app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | Your measurement ID |

---

## 6. Manual Deployment

If you prefer to deploy manually instead of using CI/CD:

### Instance 1 (App Server)

```bash
cd ~/eta-ott
git pull origin main

# Build and start
docker compose -f docker-compose.app.yml build
docker compose -f docker-compose.app.yml down
docker compose -f docker-compose.app.yml up -d

# Check health
docker compose -f docker-compose.app.yml ps
curl http://localhost/api/health
```

### Instance 2 (ML Server)

```bash
cd ~/eta-ott
git pull origin main

# Build and start
docker compose -f docker-compose.ml.yml build
docker compose -f docker-compose.ml.yml down
docker compose -f docker-compose.ml.yml up -d

# Check health
docker compose -f docker-compose.ml.yml ps
curl http://localhost:8000/
```

---

## 7. Monitoring & Logs

```bash
# View real-time logs
docker compose -f docker-compose.app.yml logs -f
docker compose -f docker-compose.ml.yml logs -f

# View specific service
docker logs eta-backend -f
docker logs eta-frontend -f
docker logs eta-ml-service -f

# Resource usage
docker stats
```

---

## 8. Rollback

```bash
# On either instance, rollback to previous version
git log --oneline -5          # Find the commit to rollback to
git checkout <commit-hash>
docker compose -f <compose-file>.yml build
docker compose -f <compose-file>.yml up -d
```

---

## 9. Troubleshooting

| Issue | Solution |
|-------|----------|
| Backend can't reach ML service | Check security group allows port 8000 from Instance 1 |
| ML service OOM killed | Increase swap: `sudo fallocate -l 4G /swapfile` |
| Frontend shows blank page | Check `VITE_API_URL=/api` was set at build time |
| Health check failing | `docker logs <container>` to see errors |
| Free tier hours exceeded | Stop instances when not in use |
