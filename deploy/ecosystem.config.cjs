module.exports = {
  apps: [
    {
      name: "epicpoetry-api",
      cwd: "/var/www/epicpoetry",
      script: "artifacts/api-server/dist/index.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      restart_delay: 5000,
      error_file: "/var/log/epicpoetry/api-error.log",
      out_file: "/var/log/epicpoetry/api-out.log",
      merge_logs: true,
    },
  ],
};
