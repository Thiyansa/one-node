#!/usr/bin/env sh

set -e

DOMAIN="${DOMAIN:-example.com}"

echo "============================================================"
echo "🗑️  Uninstalling Service for $DOMAIN"
echo "============================================================"

# 1. Remove cron job
echo "➡️ Removing cron job..."
cron_job="$HOME/app/backup.sh >> $HOME/app/backup.log"
if crontab -l 2>/dev/null | grep -q "$cron_job"; then
    crontab -l 2>/dev/null | grep -v "$cron_job" | crontab -
    echo "✅ Cron job removed"
else
    echo "ℹ️ No cron job found"
fi

# 2. Stop and remove the Node.js application via CloudLinux selector
echo "➡️ Removing Node.js application..."
if [ -f "$HOME/cx" ]; then
    $HOME/cx delete --json --user=`whoami` --app-root=$HOME/domains/$DOMAIN/public_html 2>/dev/null || true
    rm -f $HOME/cx
    echo "✅ CloudLinux application removed"
else
    echo "ℹ️ No CloudLinux app found"
fi

# 3. Remove application files
echo "➡️ Removing application files..."
if [ -d "$HOME/domains/$DOMAIN/public_html" ]; then
    rm -rf $HOME/domains/$DOMAIN/public_html/*
    echo "✅ Application files removed from public_html"
else
    echo "ℹ️ public_html directory not found"
fi

# 4. Remove Node.js environment
echo "➡️ Removing Node.js environment..."
if [ -d "$HOME/nodevenv/domains/$DOMAIN/public_html" ]; then
    rm -rf $HOME/nodevenv/domains/$DOMAIN/public_html
    echo "✅ Node.js environment removed"
else
    echo "ℹ️ Node.js environment not found"
fi

# 5. Remove backup script and logs
echo "➡️ Removing backup script and logs..."
if [ -d "$HOME/app" ]; then
    rm -rf $HOME/app
    echo "✅ Backup script removed"
else
    echo "ℹ️ Backup script not found"
fi

# 6. Clean npm cache logs
echo "➡️ Cleaning npm logs..."
rm -rf $HOME/.npm/_logs/*.log 2>/dev/null || true

echo "============================================================"
echo "✅ Uninstall Complete for $DOMAIN"
echo "------------------------------------------------------------"
echo "Removed:"
echo "  - Cron job"
echo "  - CloudLinux Node.js application"
echo "  - Application files (public_html)"
echo "  - Node.js environment"
echo "  - Backup scripts and logs"
echo "============================================================"
