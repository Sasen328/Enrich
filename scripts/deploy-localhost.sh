#!/bin/bash

##############################################################################
# ProspectSA Localhost Deployment Script
# 
# This script automates the setup and deployment of ProspectSA on localhost
# 
# Usage: ./scripts/deploy-localhost.sh [--postgres-only] [--no-seed]
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/enrich"
PORT=3000
FRONTEND_PORT=5173

# Parse command line arguments
POSTGRES_ONLY=false
NO_SEED=false

for arg in "$@"; do
  case $arg in
    --postgres-only)
      POSTGRES_ONLY=true
      shift
      ;;
    --no-seed)
      NO_SEED=true
      shift
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

##############################################################################
# Helper Functions
##############################################################################

print_header() {
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

print_info() {
  echo -e "${YELLOW}ℹ $1${NC}"
}

check_command() {
  if ! command -v "$1" &> /dev/null; then
    print_error "$1 is not installed"
    echo "Please install $1 and try again"
    exit 1
  fi
  print_success "$1 is installed"
}

##############################################################################
# Main Deployment Flow
##############################################################################

print_header "ProspectSA Localhost Deployment"

# Step 1: Check Prerequisites
print_header "Step 1: Checking Prerequisites"

echo "Checking required tools..."
check_command "node"
check_command "pnpm"
check_command "docker"
check_command "docker-compose"

# Step 2: Start Database
print_header "Step 2: Starting Database (PostgreSQL + Redis)"

echo "Starting Docker containers with docker-compose..."
if docker-compose -f docker-compose.localhost.yml up -d; then
  print_success "Docker containers started"
  sleep 3 # Wait for services to be ready
else
  print_error "Failed to start Docker containers"
  echo "Make sure Docker is running and docker-compose is available"
  exit 1
fi

# Verify PostgreSQL is ready
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker-compose -f docker-compose.localhost.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    print_success "PostgreSQL is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    print_error "PostgreSQL failed to start within 30 seconds"
    exit 1
  fi
  sleep 1
done

# Exit early if --postgres-only flag was used
if [ "$POSTGRES_ONLY" = true ]; then
  print_header "PostgreSQL Ready"
  print_info "Database is running on: $DATABASE_URL"
  echo "Run the following commands to continue:"
  echo ""
  echo "  pnpm install"
  echo "  pnpm --filter @workspace/db run db:push"
  echo "  pnpm --filter @workspace/api-server run dev"
  echo ""
  exit 0
fi

# Step 3: Check Environment
print_header "Step 3: Verifying Environment Configuration"

if [ ! -f ".env.local" ]; then
  print_info ".env.local not found, creating default..."
  cp .env.local .env.local.tmp || true
  
  cat > .env.local << EOF
DATABASE_URL=$DATABASE_URL
PORT=$PORT
NODE_ENV=development
OPENAI_API_KEY=sk-your-openai-key-here
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
EOF
  
  print_success ".env.local created"
  print_error "⚠️  IMPORTANT: Edit .env.local and add your actual API keys"
  print_error "Run: nano .env.local (or open with your editor)"
else
  print_success ".env.local already exists"
fi

# Check if API keys are set
if grep -q "sk-your-openai-key-here\|sk-ant-your-anthropic-key-here" .env.local; then
  print_error "API keys not configured!"
  echo ""
  echo "Edit .env.local and set:"
  echo "  OPENAI_API_KEY=sk-..."
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
  echo "Get keys from:"
  echo "  OpenAI: https://platform.openai.com/account/api-keys"
  echo "  Anthropic: https://console.anthropic.com/account/keys"
  exit 1
fi

print_success "API keys are configured"

# Step 4: Install Dependencies
print_header "Step 4: Installing Dependencies"

if pnpm install; then
  print_success "Dependencies installed"
else
  print_error "Failed to install dependencies"
  exit 1
fi

# Step 5: Setup Database Schema
print_header "Step 5: Setting up Database Schema"

if pnpm --filter @workspace/db run db:push; then
  print_success "Database schema applied"
else
  print_error "Failed to apply database schema"
  exit 1
fi

# Step 6: Seed Database (Optional)
if [ "$NO_SEED" = false ]; then
  print_header "Step 6: Seeding Database"
  
  if pnpm --filter @workspace/scripts run seed-import; then
    print_success "Database seeded with sample data"
  else
    print_info "Skipping seed (optional step)"
  fi
else
  print_info "Skipping database seeding (--no-seed flag used)"
fi

##############################################################################
# Deployment Complete
##############################################################################

print_header "✓ Deployment Complete!"

echo ""
echo "Your ProspectSA application is ready to run!"
echo ""
echo "Next steps:"
echo ""
echo "1. Open Terminal 1 and run:"
echo "   ${BLUE}pnpm --filter @workspace/api-server run dev${NC}"
echo ""
echo "2. Open Terminal 2 and run:"
echo "   ${BLUE}pnpm --filter @workspace/prospect-sa run dev${NC}"
echo ""
echo "3. Open your browser:"
echo "   ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
echo ""
echo "Database details:"
echo "   URL: $DATABASE_URL"
echo "   Host: localhost:5432"
echo "   User: postgres"
echo "   Password: postgres"
echo "   Database: enrich"
echo ""
echo "API Server:"
echo "   URL: http://localhost:$PORT"
echo ""
echo "To stop the database:"
echo "   ${BLUE}docker-compose -f docker-compose.localhost.yml down${NC}"
echo ""
