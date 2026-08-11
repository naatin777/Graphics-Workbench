import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = path.join(repositoryRoot, 'core');
const targetRoot = path.join(repositoryRoot, 'tui', '.core-package');

const corePackage = JSON.parse(readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
const stagedPackage = {
  name: corePackage.name,
  version: corePackage.version,
  private: true,
  type: corePackage.type,
  main: corePackage.main,
  types: corePackage.types,
  exports: corePackage.exports,
  dependencies: corePackage.dependencies,
};

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });
cpSync(path.join(coreRoot, 'dist'), path.join(targetRoot, 'dist'), { recursive: true });
writeFileSync(path.join(targetRoot, 'package.json'), `${JSON.stringify(stagedPackage, undefined, 2)}\n`);
