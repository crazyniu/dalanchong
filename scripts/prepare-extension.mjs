/**
 * Stage a readable-source extension into an isolated, minified release copy.
 * Preserve paths, exports, page-injected functions, vendor files and licenses.
 * Never rewrite maintained source, introduce eval, or generate signing credentials.
 */
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { transform } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')

export async function prepareExtension(destination) {
  const source = path.join(root, 'browser-extension')
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, {
    recursive: true,
    filter: async (entry) => {
      if ((await lstat(entry)).isSymbolicLink()) throw new Error('Source symlinks are not allowed in extension packages')
      const name = path.basename(entry)
      if (name.startsWith('.') || /\.(?:map|pem|key|p12|pfx)$/i.test(name)) return false
      const license = name === 'THIRD_PARTY_NOTICES.md'
        || /^(?:license|copying|notice)/i.test(name) || /\.LEGAL(?:\.|$)/i.test(name)
        || path.relative(source, entry).split(path.sep).includes('licenses')
      return !/\.md$/i.test(name) || license
    },
  })
  // Release copies always use online licensing, regardless of local test activation.
  await writeFile(path.join(destination, 'shared/build-mode.js'), 'export const testLicense = null;\n')
  // Standalone releases only update the staged manifest, never maintained source.
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const manifestPath = path.join(destination, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = version
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  await minifyOwnedScripts(destination)

}

async function minifyOwnedScripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor' && entry.name !== 'licenses') await minifyOwnedScripts(file)
    } else if (/\.(?:js|mjs)$/.test(entry.name)) {
      // MAIN-world func injections lose the worker's scope. Keep modern syntax
      // native and avoid name-preservation helpers or cross-file transformations.
      const result = await transform(await readFile(file, 'utf8'), {
        target: 'chrome116',
        minifyWhitespace: true,
        minifyIdentifiers: true,
        minifySyntax: false,
        keepNames: false,
        sourcemap: false,
        legalComments: 'inline',
      })
      await writeFile(file, result.code)
    }
  }
}
