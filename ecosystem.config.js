module.exports = {
  apps: [
    {
      name: 'tifin-desk',
      script: 'dist/main.js',
      wait_ready: true,
      kill_timeout: 300000,
    },
  ],
};
