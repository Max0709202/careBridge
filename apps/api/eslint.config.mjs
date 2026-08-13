import { carebridgeConfig } from '@carebridge/eslint-config';

export default carebridgeConfig({
  tsconfigRootDir: import.meta.dirname,
  project: ['./tsconfig.json'],
});
