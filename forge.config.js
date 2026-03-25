export default {
  packagerConfig: {
    name: 'ProductivitySystem',
    executableName: 'productivity-system',
    icon: './assets/icon',
    asar: true,
    ignore: [
      /^\/mcp-server/,
      /^\/docs/,
      /^\/\.git/,
      /node_modules\/\.cache/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ProductivitySystem',
        setupIcon: './assets/icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './assets/icon.png',
          categories: ['Utility', 'Office'],
        },
      },
    },
  ],
};
