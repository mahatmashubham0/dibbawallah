module.exports = {
  apps: [
    {
      name: 'tifn-os',
      script: 'dist/main.js',
      wait_ready: true,
      kill_timeout: 300000,
    },
  ],
};
