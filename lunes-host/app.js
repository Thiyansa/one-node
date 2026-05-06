const { spawn } = require('child_process');
const path = require('path');

// Configuration: මෙතැනට ඔබට අවශ්‍ය binaries ප්‍රමාණය ඇතුළත් කළ හැකියි
const apps = [
  {
    name: "Xray",
    binaryPath: path.join(__dirname, 'xy', 'xy'),
    args: ['run', '-c', path.join(__dirname, 'xy', 'config.json')]
  }
];

/**
 * Process එක run කරන සහ එය exit වුවහොත් නැවත start කරන function එක
 */
function runProcess(app) {
  console.log(`[START] Starting ${app.name}...`);

  // spawn භාවිතා කර binary එක run කිරීම
  const child = spawn(app.binaryPath, app.args);

  // Output logs බලාගැනීමට (stdout)
  child.stdout.on('data', (data) => {
    console.log(`[${app.name} STDOUT]: ${data}`);
  });

  // Error logs බලාගැනීමට (stderr)
  child.stderr.on('data', (data) => {
    console.error(`[${app.name} STDERR]: ${data}`);
  });

  // Process එක close වූ විට ක්‍රියාත්මක වන කොටස
  child.on("exit", (code) => {
    console.log(`[EXIT] ${app.name} exited with code: ${code}`);
    console.log(`[RESTART] Restarting ${app.name} in 3 seconds...`);
    
    // තත්පර 3කට පසු නැවත runProcess function එක call කිරීම
    setTimeout(() => runProcess(app), 3000);
  });
}

/**
 * ප්‍රධාන function එක
 */
function main() {
  try {
    console.log("Initializing process manager...");
    for (const app of apps) {
      runProcess(app);
    }
  } catch (err) {
    console.error("[ERROR] Startup failed:", err);
    process.exit(1);
  }
}

// ආරම්භය
main();
