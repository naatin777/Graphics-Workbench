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
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
};
type ManifestCommand = { command: string };
type ManifestMenu = { command: string; group?: string; when?: string };
type PackageManifest = {
  name: string;
  contributes: {
    commands: ManifestCommand[];
    configuration: { properties: Record<string, JsonSchema> };
    menus?: Record<string, ManifestMenu[]>;
    submenus?: { id: string }[];
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

function commandConstantName(commandId: string, extensionPrefix: string): string {
  const suffix = commandId.slice(extensionPrefix.length);
  const snake = suffix
    .replaceAll('.', '_')
    .replaceAll(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
  return `${snake}_COMMAND`;
}

type ConversionNamespace = 'outputPath' | 'outputPaths';

const formatNames: Record<string, string> = {
  Png: 'png',
  Jpeg: 'jpeg',
  Webp: 'webp',
  Avif: 'avif',
  Gif: 'gif',
  Tiff: 'tiff',
  Svg: 'svg',
  Pdf: 'pdf',
  Mermaid: 'mermaid',
  Drawio: 'drawio',
  Eps: 'eps',
};

type ConversionPair = {
  source: string | null;
  target: string;
  setting: string;
  namespace: ConversionNamespace;
};

function sortConversionPairs(pairs: ConversionPair[]): void {
  pairs.sort((first, second) =>
    `${first.target}.${first.source ?? 'any'}.${first.setting}`.localeCompare(
      `${second.target}.${second.source ?? 'any'}.${second.setting}`,
    ),
  );
}

function conversionPairFromKey(key: string, namespace: ConversionNamespace): ConversionPair | undefined {
  const match = /^convert([A-Za-z]+)To([A-Za-z]+)$/u.exec(key);
  if (match === null) {
    return undefined;
  }
  const sourceName = match[1];
  const targetName = match[2];
  if (sourceName === undefined || targetName === undefined) {
    return undefined;
  }
  const target = formatNames[targetName];
  if (target === undefined) {
    return undefined;
  }
  return { source: formatNames[sourceName] ?? null, target, setting: key, namespace };
}

function renderConversionPairs(packageJson: PackageManifest): string {
  const properties = packageJson.contributes.configuration.properties;
  const flatPairs: ConversionPair[] = [];
  const pluralPairs: ConversionPair[] = [];
  const extensionPrefix = `${packageJson.name}.`;

  for (const [fullKey] of Object.entries(properties)) {
    const key = fullKey.slice(extensionPrefix.length);
    if (!key.startsWith('outputPath.')) {
      continue;
    }
    const pair = conversionPairFromKey(key.slice('outputPath.'.length), 'outputPath');
    if (pair !== undefined) {
      flatPairs.push(pair);
    }
  }

  const pluralProperties = properties[`${extensionPrefix}outputPaths`]?.properties;
  if (pluralProperties !== undefined) {
    for (const key of Object.keys(pluralProperties)) {
      const pair = conversionPairFromKey(key, 'outputPaths');
      if (pair !== undefined) {
        pluralPairs.push(pair);
      }
    }
  }

  sortConversionPairs(flatPairs);
  sortConversionPairs(pluralPairs);

  const renderPairs = (pairs: ConversionPair[]): string =>
    pairs
      .map((pair) => {
        const source = pair.source === null ? 'null' : quote(pair.source);
        return `    { source: ${source}, target: ${quote(pair.target)}, setting: ${quote(pair.setting)} },`;
      })
      .join('\n');

  return (
    `export const conversionPairs = {\n` +
    `  flat: [\n${renderPairs(flatPairs)}\n  ],\n` +
    `  plural: [\n${renderPairs(pluralPairs)}\n  ],\n` +
    `} as const;\n`
  );
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
    const getter = `defineConfiguration<${valueType}>(configurationReader, ${quote(node.key)}, ${literal(defaultValue)})`;
    const propertyLine = `${indentation}${property}: ${getter},`;
    if (propertyLine.length <= 120) {
      lines.push(propertyLine);
      continue;
    }
    lines.push(
      `${indentation}${property}: defineConfiguration<${valueType}>(\n${indentation}  configurationReader,\n${indentation}  ${quote(node.key)},\n${indentation}  ${literal(defaultValue)},\n${indentation}),`,
    );
  }
  return `{
${lines.join('\n')}
${indentation.slice(0, -2)}}`;
}

function schemaTypes(schema: JsonSchema): string[] {
  if (schema.type === undefined) {
    throw new Error('Configuration type is missing');
  }
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function describeConfigurationEnumValue(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    throw new Error('Configuration enums must contain primitive values');
  }
  return String(value);
}

function describeConfigurationSchema(schema: JsonSchema): string {
  if (schema.enum !== undefined) {
    return `one of ${schema.enum.map((value) => describeConfigurationEnumValue(value)).join(', ')}`;
  }
  return schemaTypes(schema)
    .map((type) => {
      if (type !== 'array') {
        return type;
      }
      return schema.items === undefined ? 'array' : `array of ${describeConfigurationSchema(schema.items)}`;
    })
    .join(' or ');
}

function renderConfigurationSchema(schema: JsonSchema, indentation: string): string {
  if (schema.enum?.some((value) => typeof value === 'object' && value !== null)) {
    throw new Error('Configuration enums must contain primitive values');
  }

  const childIndentation = `${indentation}  `;
  const lines = [
    `${childIndentation}types: [${schemaTypes(schema)
      .map((type) => quote(type))
      .join(', ')}],`,
  ];
  if (schema.enum !== undefined) {
    lines.push(`${childIndentation}enumValues: [${schema.enum.map((value) => literal(value)).join(', ')}],`);
  }
  if (schema.minimum !== undefined) {
    lines.push(`${childIndentation}minimum: ${literal(schema.minimum)},`);
  }
  if (schema.maximum !== undefined) {
    lines.push(`${childIndentation}maximum: ${literal(schema.maximum)},`);
  }
  if (schema.items !== undefined) {
    lines.push(`${childIndentation}items: ${renderConfigurationSchema(schema.items, childIndentation)},`);
  }
  if (schema.properties !== undefined) {
    const properties = Object.entries(schema.properties).map(
      ([key, property]) =>
        `${childIndentation}  ${propertyName(key)}: ${renderConfigurationSchema(property, `${childIndentation}  `)},`,
    );
    lines.push(`${childIndentation}properties: {\n${properties.join('\n')}\n${childIndentation}},`);
  }
  if (schema.additionalProperties !== undefined) {
    lines.push(`${childIndentation}additionalProperties: ${schema.additionalProperties},`);
  }

  return `{\n${lines.join('\n')}\n${indentation}}`;
}

function renderConfigurationSchemas(configurationEntries: [string, JsonSchema][], extensionPrefix: string): string {
  const schemas = configurationEntries.map(
    ([fullKey, schema]) =>
      `  ${propertyName(fullKey.slice(extensionPrefix.length))}: ${renderConfigurationSchema(schema, '  ')},`,
  );
  return `const configurationSchemas: Record<ConfigurationKey, ConfigurationSchema> = {\n${schemas.join('\n')}\n};\n`;
}

function renderConfigurationExpectations(
  configurationEntries: [string, JsonSchema][],
  extensionPrefix: string,
): string {
  const expectations = configurationEntries.map(
    ([fullKey, schema]) =>
      `  ${propertyName(fullKey.slice(extensionPrefix.length))}: ${quote(describeConfigurationSchema(schema))},`,
  );
  return `const configurationExpectations: Record<ConfigurationKey, string> = {\n${expectations.join('\n')}\n};\n`;
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

function renderConfigurationModule(extensionName: string): string {
  return `import * as vscode from 'vscode';

import { createConfiguration, type Configuration } from './generated-extension-meta.js';

export function getExtensionConfiguration(): Configuration {
  return createConfiguration({
    get(key: string): unknown {
      return vscode.workspace.getConfiguration(${quote(extensionName)}).get<unknown>(key);
    },
  });
}
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
    `export type ConfigurationReader = {\n  get(key: string): unknown;\n};\n\n` +
    `type ConfigurationGetter<Value> = () => Value;\n\n` +
    `type ConfigurationSchemaType = 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';\n\n` +
    `type ConfigurationSchema = {\n  types: readonly ConfigurationSchemaType[];\n  enumValues?: readonly (string | number | boolean | null)[];\n  minimum?: number;\n  maximum?: number;\n  items?: ConfigurationSchema;\n  properties?: Readonly<Record<string, ConfigurationSchema>>;\n  additionalProperties?: boolean;\n};\n\n` +
    `function isConfigurationObject(value: unknown): value is Record<string, unknown> {\n  return typeof value === 'object' && value !== null && !Array.isArray(value);\n}\n\n` +
    `function isNumberWithinBounds(value: number, schema: ConfigurationSchema): boolean {\n  return (\n    (schema.minimum === undefined || value >= schema.minimum) &&\n    (schema.maximum === undefined || value <= schema.maximum)\n  );\n}\n\n` +
    `function matchesConfigurationObject(value: unknown, schema: ConfigurationSchema): boolean {\n  if (!isConfigurationObject(value)) {\n    return false;\n  }\n\n  for (const [key, propertyValue] of Object.entries(value)) {\n    const propertySchema = schema.properties?.[key];\n    if (propertySchema === undefined) {\n      if (schema.additionalProperties === false) {\n        return false;\n      }\n      continue;\n    }\n    if (!matchesConfigurationSchema(propertyValue, propertySchema)) {\n      return false;\n    }\n  }\n\n  return true;\n}\n\n` +
    `function matchesConfigurationType(value: unknown, type: ConfigurationSchemaType, schema: ConfigurationSchema): boolean {\n  switch (type) {\n    case 'array': {\n      if (!Array.isArray(value)) {\n        return false;\n      }\n      const { items } = schema;\n      return items === undefined || value.every((item) => matchesConfigurationSchema(item, items));\n    }\n    case 'boolean': {\n      return typeof value === 'boolean';\n    }\n    case 'integer': {\n      return typeof value === 'number' && Number.isInteger(value) && isNumberWithinBounds(value, schema);\n    }\n    case 'number': {\n      return typeof value === 'number' && Number.isFinite(value) && isNumberWithinBounds(value, schema);\n    }\n    case 'object': {\n      return matchesConfigurationObject(value, schema);\n    }\n    case 'string': {\n      return typeof value === 'string';\n    }\n    default: {\n      return false;\n    }\n  }\n}\n\n` +
    `function matchesConfigurationSchema(value: unknown, schema: ConfigurationSchema): boolean {\n  if (!schema.types.some((type) => matchesConfigurationType(value, type, schema))) {\n    return false;\n  }\n  return schema.enumValues === undefined || schema.enumValues.some((candidate) => candidate === value);\n}\n\n` +
    renderConfigurationSchemas(configurationEntries, extensionPrefix) +
    renderConfigurationExpectations(configurationEntries, extensionPrefix) +
    `function configurationValueType(value: unknown): string {\n  if (Array.isArray(value)) {\n    return 'array';\n  }\n  if (value === null) {\n    return 'null';\n  }\n  return typeof value;\n}\n\n` +
    `function assertConfigurationValue<Value>(\n  key: ConfigurationKey,\n  value: unknown,\n  _defaultValue: Value,\n): asserts value is Value {\n  if (!matchesConfigurationSchema(value, configurationSchemas[key])) {\n    throw new TypeError(\n      \`Invalid configuration value for graphics-workbench.\${key}: expected \${configurationExpectations[key]}, received \${configurationValueType(value)}.\`,\n    );\n  }\n}\n\n` +
    `function defineConfiguration<Value>(\n  configurationReader: ConfigurationReader,\n  key: ConfigurationKey,\n  defaultValue: Value,\n): ConfigurationGetter<Value> {\n` +
    `  return (): Value => {\n    const value = configurationReader.get(key);\n    if (value === undefined) {\n      return defaultValue;\n    }\n    assertConfigurationValue(key, value, defaultValue);\n    return value;\n  };\n` +
    `}\n\n` +
    objectTypes.map(({ name, schema }) => renderObjectType(name, schema)).join('\n') +
    `export const publicCommandIds = [\n${commandIdList.join('\n')}\n] as const;\n\n` +
    commandIds
      .map((commandId) => `export const ${commandConstantName(commandId, extensionPrefix)} = ${quote(commandId)};`)
      .join('\n') +
    '\n\n' +
    renderConversionPairs(packageJson) +
    '\n' +
    `// oxlint-disable-next-line typescript/explicit-function-return-type -- Generated return type is derived from the manifest.\n` +
    `function createConfigurationInternal(configurationReader: ConfigurationReader) {\n` +
    `  return ${renderConfigs(configurationTree, '    ')} as const;\n` +
    `}\n\n` +
    `export type Configuration = ReturnType<typeof createConfigurationInternal>;\n` +
    `export function createConfiguration(configurationReader: ConfigurationReader): Configuration {\n` +
    `  return createConfigurationInternal(configurationReader);\n` +
    `}\n\n` +
    `export type GetConfiguration = () => Configuration;\n\n` +
    `const defaultConfigurationReader: ConfigurationReader = {\n` +
    `  get(_key: string): undefined {\n` +
    `    return undefined;\n` +
    `  },\n` +
    `};\n\n` +
    `export const getDefaultConfiguration: GetConfiguration = () => createConfiguration(defaultConfigurationReader);\n`;

  return { metadata, configuration: renderConfigurationModule(packageJson.name) };
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
