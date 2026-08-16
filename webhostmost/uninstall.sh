#!/usr/bin/env sh

set -e

DOMAIN="${DOMAIN:-example.com}"
FORCE="${FORCE:-false}"

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

# 2. Kill any running Node.js processes for this domain
echo "➡️ Killing running Node.js processes..."
pkill -f "node.*$DOMAIN" 2>/dev/null || true
pkill -f "app.js.*$DOMAIN" 2>/dev/null || true
echo "✅ Node.js processes killed"

# 3. Stop and remove the Node.js application via CloudLinux selector
echo "➡️ Removing Node.js application..."
if [ -f "$HOME/cx" ]; then
    # Try normal delete first
    $HOME/cx delete --json --user=`whoami` --app-root=$HOME/domains/$DOMAIN/public_html 2>/dev/null || true
    
    # If force is enabled, try force delete
    if [ "$FORCE" = "true" ]; then
        $HOME/cx delete --json --user=`whoami` --app-root=$HOME/domains/$DOMAIN/public_html --force 2>/dev/null || true
    fi
    
    rm -f $HOME/cx
    echo "✅ CloudLinux application removed"
else
    echo "ℹ️ No CloudLinux app found"
fi

# 4. Clear CloudLinux cache
echo "➡️ Clearing CloudLinux cache..."
rm -rf $HOME/.cloudlinux-selector/cache/* 2>/dev/null || true
echo "✅ Cache cleared"

# 5. Remove application files
echo "➡️ Removing application files..."
if [ -d "$HOME/domains/$DOMAIN/public_html" ]; then
    # Remove all files including hidden files
    rm -rf $HOME/domains/$DOMAIN/public_html/* 2>/dev/null || true
    rm -rf $HOME/domains/$DOMAIN/public_html/.* 2>/dev/null || true
    echo "✅ Application files removed from public_html"
else
    echo "ℹ️ public_html directory not found"
fi

# 6. Remove Node.js environment
echo "➡️ Removing Node.js environment..."
if [ -d "$HOME/nodevenv/domains/$DOMAIN" ]; then
    rm -rf $HOME/nodevenv/domains/$DOMAIN
    echo "✅ Node.js environment removed"
else
    echo "ℹ️ Node.js environment not found"
fi

# 7. Remove backup script and logs
echo "➡️ Removing backup script and logs..."
if [ -d "$HOME/app" ]; then
    # Remove only domain-specific backup files if exist
    if [ -f "$HOME/app/backup.sh" ]; then
        rm -f $HOME/app/backup.sh
        rm -f $HOME/app/backup.log
        echo "✅ Backup script and logs removed"
    fi
    # Remove app directory if empty
    rmdir $HOME/app 2>/dev/null || true
else
    echo "ℹ️ Backup script not found"
fi

# 8. Clean npm cache logs
echo "➡️ Cleaning npm logs..."
rm -rf $HOME/.npm/_logs/*.log 2>/dev/null || true
rm -rf $HOME/.npm/_cacache/* 2>/dev/null || true

# 9. Remove any leftover socket files
echo "➡️ Removing leftover socket files..."
find /tmp -name "*$DOMAIN*" -type s 2>/dev/null -delete || true
find /tmp -name "node-*" -type s 2>/dev/null -delete || true

# 10. Verify removal
echo "➡️ Verifying removal..."
if [ -d "$HOME/domains/$DOMAIN/public_html" ] && [ "$(ls -A $HOME/domains/$DOMAIN/public_html 2>/dev/null)" ]; then
    echo "⚠️ Warning: Some files remain in public_html"
else
    echo "✅ public_html is empty"
fi

if [ -d "$HOME/nodevenv/domains/$DOMAIN" ]; then
    echo "⚠️ Warning: Node.js environment still exists"
else
    echo "✅ Node.js environment removed"
fi

echo "============================================================"
echo "✅ Uninstall Complete for $DOMAIN"
echo "------------------------------------------------------------"
echo "Removed:"
echo "  - Cron job"
echo "  - Running Node.js processes"
echo "  - CloudLinux Node.js application"
echo "  - CloudLinux cache"
echo "  - Application files (public_html)"
echo "  - Node.js environment"
echo "  - Backup scripts and logs"
echo "  - npm cache"
echo "  - Leftover socket files"
if [ "$FORCE" = "true" ]; then
    echo "  - Force delete was used"
fi
echo "============================================================"
