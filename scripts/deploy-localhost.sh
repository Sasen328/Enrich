#!/bin/bash

##############################################################################
# ProspectSA Localhost Deployment Script
#
# Aligns with DEPLOY.md Section 1 (Official Docker Compose approach)
# Automates: docker-compose up --build
#
# Usage: ./scripts/deploy-localhost.sh
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

##############################################################################
# Helper Functions
##############################################################################

print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
  echo -e "${YELLOW}ℹ $1${NC}"
}

check_command() {
  if ! command -v "$1" &> /dev/null; then
    print_error "$1 is not installed"
    echo "Please install $1 and try again"
    return 1
  fi
  print_success "$1 is installed"
  return 0
}

##############################################################################
# Main Deployment Flow
##############################################################################

print_header "ProspectSA Localhost Deployment (Official Docker Compose)"

# Step 1: Check Prerequisites
print_header "Step 1: Checking Prerequisites"

echo "Checking required tools..."
MISSING=0

if ! check_command "docker"; then
  MISSING=1
fi

if ! check_command "git"; then
  MISSING=1
fi

if [ $MISSING -eq 1 ]; then
  print_error "Missing required tools. Please install Docker and Git."
  exit 1
fi

print_success "All prerequisites installed"

# Step 2: Check for .env file
print_header "Step 2: Setting up Environment"

if [ ! -f ".env" ]; then
  if [ -f ".env.docker" ]; then
    print_info ".env not found. Creating from .env.docker..."
    cp .env.docker .env
    print_success ".env created"
  else
    print_error ".env.docker not found in current directory"
    exit 1
  fi
else
  print_success ".env already exists"
fi

# Check if any LLM key is configured (non-empty)
if ! grep -E "^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=" .env | grep -v "=$" > /dev/null 2>&1; then
  print_warning "No LLM API keys detected in .env"
  echo ""
  echo "Edit .env and set at least ONE of these:"
  echo ""
  echo "  OPENROUTER_API_KEY=sk-or-v1-...     (cheapest — free models)"
  echo "  ANTHROPIC_API_KEY=sk-ant-...        (Claude)"
  echo "  OPENAI_API_KEY=sk-proj-...          (GPT-4o)"
  echo ""
  echo "Get keys from:"
  echo "  OpenRouter: https://openrouter.ai/keys"
  echo "  Anthropic:  https://console.anthropic.com"
  echo "  OpenAI:     https://platform.openai.com/api-keys"
  echo ""
fi

# Step 3: Start Docker Compose
print_header "Step 3: Building and Starting Services"

echo "Running: docker compose up --build"
echo "(First time takes 5-10 minutes. Subsequent runs are faster.)"
echo ""

if docker compose up --build; then
  print_success "Docker Compose started successfully"
else
  print_error "Docker Compose failed to start"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Make sure Docker Desktop is open and running"
  echo "  2. Check: docker --version"
  echo "  3. Try: docker compose logs to see error details"
  exit 1
fi

##############################################################################
# Success
##############################################################################

print_header "✓ Deployment Complete"

echo ""
echo "Your ProspectSA app is running at:"
echo -e "${BLUE}http://localhost:3000${NC}"
echo ""
echo "See ${BLUE}DEPLOY.md${NC} (Section 1) for:"
echo "  • Stop/restart commands"
echo "  • Troubleshooting"
echo "  • Database access"
echo "  • Verification checks"
echo ""
