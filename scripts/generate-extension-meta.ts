import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonSchema = {
  type?: string | string[];
  enum?: readonly JsonValue[];
  default?: JsonValue;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
};
type ManifestCommand = { command: string };
type PackageManifest = {
  name: string;
  contributes: {
    commands: ManifestCommand[];
    configuration: { properties: Record<string, JsonSchema> };
  };
};
type ConfigNode =
  | { kind: 'branch'; children: Map<string, ConfigNode> }
  | { kind: 'config'; key: string; schema: JsonSchema };
type ObjectProperty = [key: string, schema: JsonSchema];
type ObjectType = { name: string; schema: JsonSchema };

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(repositoryRoot, 'package.json');
const metadataOutputPath = path.join(repositoryRoot, 'src/generated-extension-meta.ts');
const configurationOutputPath = path.join(repositoryRoot, 'src/generated-extension-config.ts');
const checkOnly = process.argv.includes('--check');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestCommand(value: unknown): value is ManifestCommand {
  return isRecord(value) && typeof value.command === 'string';
}

function isPackageManifest(value: unknown): value is PackageManifest {
  if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.contributes)) {
    return false;
  }

  const commands = value.contributes.commands;
  const configuration = value.contributes.configuration;
  return (
    Array.isArray(commands) &&
    commands.every((command) => isManifestCommand(command)) &&
    isRecord(configuration) &&
    isRecord(configuration.properties)
  );
}

function quote(value: string): string {
  const json = JSON.stringify(value);
  return `'${json.slice(1, -1).replaceAll("'", "\\'")}'`;
}

function literal(value: JsonValue, indentation = ''): string {
  if (typeof value === 'string') {
    return quote(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => literal(item, indentation)).join(', ')}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }
  const childIndentation = `${indentation}  `;
  const properties = entries.map(
    ([key, item]) => `${childIndentation}${propertyName(key)}: ${literal(item, childIndentation)},`,
  );
  return `{
${properties.join('\n')}
${indentation}}`;
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) ? value : quote(value);
}

function pascalCase(value: string): string {
  return value
    .split('.')
    .map((part) => (part.length === 0 ? '' : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join('');
}

function schemaType(schema: JsonSchema, typeName: string): string {
  if (schema.enum !== undefined) {
    if (schema.enum.length === 0) {
      throw new Error(`Enum must not be empty for ${typeName}`);
    }
    return schema.enum.map((value) => literal(value)).join(' | ');
  }

  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => schemaType({ ...schema, type }, typeName)).join(' | ');
  }

  switch (schema.type) {
    case 'array': {
      const itemType = schema.items === undefined ? 'unknown' : schemaType(schema.items, `${typeName}Item`);
      return itemType.includes(' | ') ? `(${itemType})[]` : `${itemType}[]`;
    }
    case 'boolean': {
      return 'boolean';
    }
    case 'integer':
    case 'number': {
      return 'number';
    }
    case 'object': {
      return typeName;
    }
    case 'string': {
      return 'string';
    }
    case undefined: {
      throw new Error(`Configuration type is missing for ${typeName}`);
    }
    default: {
      throw new Error(`Unsupported configuration type for ${typeName}: ${JSON.stringify(schema.type)}`);
    }
  }
}

function insertConfig(root: Map<string, ConfigNode>, segments: string[], leaf: ConfigNode): void {
  const segment = segments.at(0);
  if (segment === undefined) {
    throw new Error('Configuration key must not be empty');
  }

  if (segments.length === 1) {
    if (root.has(segment)) {
      throw new Error(`Duplicate configuration key: ${segments.join('.')}`);
    }
    root.set(segment, leaf);
    return;
  }

  const existing = root.get(segment);
  if (existing !== undefined && existing.kind !== 'branch') {
    throw new Error(`Configuration key conflicts with a branch: ${segments.join('.')}`);
  }
  const branch = existing ?? { kind: 'branch', children: new Map<string, ConfigNode>() };
  root.set(segment, branch);
  insertConfig(branch.children, segments.slice(1), leaf);
}

function renderConfigs(tree: Map<string, ConfigNode>, indentation: string): string {
  const lines: string[] = [];
  for (const [name, node] of tree) {
    if (node.kind === 'branch') {
      lines.push(`${indentation}${propertyName(name)}: ${renderConfigs(node.children, `${indentation}  `)},`);
      continue;
    }

    const valueType = schemaType(node.schema, pascalCase(node.key));
    const defaultValue = node.schema.default;
    if (defaultValue === undefined) {
      throw new Error(`Configuration key is missing a default: ${node.key}`);
    }
    const property = propertyName(name);
    const getter = `defineConfiguration<${valueType}>(${quote(node.key)}, ${literal(defaultValue)})`;
    const propertyLine = `${indentation}${property}: ${getter},`;
    if (propertyLine.length <= 120) {
      lines.push(propertyLine);
      continue;
    }
    lines.push(
      `${indentation}${property}: defineConfiguration<${valueType}>(\n${indentation}  ${quote(node.key)},\n${indentation}  ${literal(defaultValue)},\n${indentation}),`,
    );
  }
  return `{
${lines.join('\n')}
${indentation.slice(0, -2)}}`;
}

function renderBoundConfigs(tree: Map<string, ConfigNode>, indentation: string, accessPath: string): string {
  const lines: string[] = [];
  for (const [name, node] of tree) {
    const property = propertyName(name);
    const getterPath = `${accessPath}.${property}`;
    if (node.kind === 'branch') {
      lines.push(`${indentation}${property}: ${renderBoundConfigs(node.children, `${indentation}  `, getterPath)},`);
      continue;
    }
    lines.push(`${indentation}${property}: () => ${getterPath}(configuration),`);
  }
  return `{
${lines.join('\n')}
${indentation.slice(0, -2)}}`;
}

function renderObjectType(name: string, schema: JsonSchema): string {
  const properties = Object.entries(schema.properties ?? {});
  if (name !== 'OutputPaths') {
    const members = properties.map(
      ([key, property]) => `  readonly ${propertyName(key)}?: ${schemaType(property, `${name}${pascalCase(key)}`)};`,
    );
    return `export type ${name} = {
${members.join('\n')}
};
`;
  }

  const groups = new Map<string, ObjectProperty[]>();
  for (const [key, property] of properties) {
    const destination = /^convert[A-Za-z]+To([A-Z][a-z]+)$/u.exec(key)?.[1] ?? 'Other';
    const group = groups.get(destination) ?? [];
    group.push([key, property]);
    groups.set(destination, group);
  }

  const groupTypes = [...groups.entries()].map(([destination, group]) => {
    const groupName = `${name}To${destination}`;
    const members = group.map(
      ([key, property]) =>
        `  readonly ${propertyName(key)}?: ${schemaType(property, `${groupName}${pascalCase(key)}`)};`,
    );
    return `type ${groupName} = {
${members.join('\n')}
};
`;
  });
  const outputType = [...groups.keys()].map((destination) => `${name}To${destination}`).join(' &\n  ');
  return `${groupTypes.join('\n')}\nexport type ${name} = ${outputType};
`;
}

function renderConfigurationModule(extensionName: string, configurationTree: Map<string, ConfigNode>): string {
  return `import * as vscode from 'vscode';

import { configs as configGetters } from './generated-extension-meta.js';

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(${quote(extensionName)});
}

const configuration = getExtensionConfiguration();

export const configs = ${renderBoundConfigs(configurationTree, '  ', 'configGetters')} as const;
`;
}

function generate(packageJson: PackageManifest): { metadata: string; configuration: string } {
  const extensionPrefix = `${packageJson.name}.`;
  const configurationTree = new Map<string, ConfigNode>();
  const objectTypes: ObjectType[] = [];
  const configurationEntries = Object.entries(packageJson.contributes.configuration.properties);
  for (const [fullKey, schema] of configurationEntries) {
    if (!fullKey.startsWith(extensionPrefix)) {
      throw new Error(`Configuration key is outside the extension namespace: ${fullKey}`);
    }
    if (!Object.hasOwn(schema, 'default')) {
      throw new Error(`Configuration key is missing a default: ${fullKey}`);
    }

    const key = fullKey.slice(extensionPrefix.length);
    const typeName = schema.type === 'object' ? pascalCase(key) : undefined;
    if (typeName !== undefined) {
      objectTypes.push({ name: typeName, schema });
    }
    insertConfig(configurationTree, key.split('.'), { kind: 'config', key, schema });
  }

  const commandIds = packageJson.contributes.commands.map(({ command }) => command);
  for (const command of commandIds) {
    if (!command.startsWith(extensionPrefix)) {
      throw new Error(`Command ID is outside the extension namespace: ${command}`);
    }
  }

  const configurationKeys = configurationEntries.map(
    ([fullKey]) => `  | ${quote(fullKey.slice(extensionPrefix.length))}`,
  );
  const commandIdList = commandIds.map((command) => `  ${quote(command)},`);
  const metadata =
    `// This file is generated by scripts/generate-extension-meta.ts.\n// Do not edit it directly; change package.json and regenerate it.\n\n` +
    `type ConfigurationKey =\n${configurationKeys.join('\n')};\n\n` +
    `export type ConfigurationReader = {\n  get<T>(key: string, defaultValue?: T): T | undefined;\n};\n\n` +
    `type ConfigurationGetter<Value> = (configuration?: ConfigurationReader) => Value;\n\n` +
    `function defineConfiguration<Value>(key: ConfigurationKey, defaultValue: Value): ConfigurationGetter<Value> {\n` +
    `  return (configuration?: ConfigurationReader): Value => configuration?.get<Value>(key) ?? defaultValue;\n` +
    `}\n\n` +
    objectTypes.map(({ name, schema }) => renderObjectType(name, schema)).join('\n') +
    `export const publicCommandIds = [\n${commandIdList.join('\n')}\n] as const;\n\n` +
    `export const configs = ${renderConfigs(configurationTree, '  ')} as const;\n`;

  return { metadata, configuration: renderConfigurationModule(packageJson.name, configurationTree) };
}

function readPackageManifest(): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!isPackageManifest(parsed)) {
    throw new Error('package.json does not match the expected extension manifest shape');
  }
  return parsed;
}

function checkGeneratedFile(filePath: string, expected: string): boolean {
  let current: string;
  try {
    current = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw new Error(`Failed to read generated file: ${filePath}`, { cause: error });
  }
  return current === expected;
}

const generated = generate(readPackageManifest());
if (checkOnly) {
  const metadataIsCurrent = checkGeneratedFile(metadataOutputPath, generated.metadata);
  const configurationIsCurrent = checkGeneratedFile(configurationOutputPath, generated.configuration);
  if (!metadataIsCurrent || !configurationIsCurrent) {
    process.stderr.write('Generated extension metadata is out of date. Run npm run generate:extension-meta.\n');
    process.exitCode = 1;
  }
} else {
  writeFileSync(metadataOutputPath, generated.metadata);
  writeFileSync(configurationOutputPath, generated.configuration);
}
