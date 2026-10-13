import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'ink') {
    const targetPath = path.resolve(process.cwd(), 'source/vendor/ink/src/index.ts');
    return {
      format: 'module',
      shortCircuit: true,
      url: pathToFileURL(targetPath).href
    };
  }
  return nextResolve(specifier, context);
}
