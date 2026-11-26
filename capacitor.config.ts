import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.noorelahi.learning',
  appName: 'NOOR ELAHI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Filesystem: {
      // Uses Android runtime permissions configured in AndroidManifest.xml
    },
  },
};

export default config;
