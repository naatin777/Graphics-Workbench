import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  minLength?: number;
};
type ManifestCommand = { command: string; title?: string; category?: string };
type ManifestMenu = { command?: string; submenu?: string; group?: string; when?: string };
type CustomEditorContribution = {
  viewType: string;
  displayName?: string;
  selector?: { filenamePattern?: string; filename?: string }[];
  priority?: 'default' | 'option';
};
export type PackageManifest = {
  name: string;
  publisher?: string;
  displayName?: string;
  version?: string;
  repository?: { type?: string; url?: string };
  contributes: {
    commands: ManifestCommand[];
    configuration: { properties: Record<string, JsonSchema> };
    menus?: Record<string, ManifestMenu[]>;
    submenus?: { id: string; label?: string }[];
    customEditors?: CustomEditorContribution[];
  };
};
type ConfigNode =
  | { kind: 'branch'; children: Map<string, ConfigNode> }
  | { kind: 'config'; key: string; schema: JsonSchema };
type ObjectType = { name: string; schema: JsonSchema };

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(repositoryRoot, 'package.json');
const metadataOutputPath = path.join(repositoryRoot, 'src/generated/extension_manifest.ts');
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

  const { commands } = value.contributes;
  const { configuration } = value.contributes;
  return (
    Array.isArray(commands) &&
    commands.every((command) => isManifestCommand(command)) &&
    isRecord(configuration) &&
    isRecord(configuration.properties)
  );
}

function quote(value: string): string {
  // JSON.stringify produces double-quoted output with \" for embedded quotes.
  // The generated code uses single-quoted strings, where `"` needs no escape.
  // Remove the JSON quote escape after escaping single quotes for the
  // single-quoted literal; backslash escapes (\n, \\, \uXXXX) are preserved.
  const json = JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'").replaceAll('\\"', '"');
  return `'${json}'`;
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
  if (schema.minLength !== undefined) {
    lines.push(`${childIndentation}minLength: ${literal(schema.minLength)},`);
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

function renderObjectType(name: string, schema: JsonSchema): string {
  const properties = Object.entries(schema.properties ?? {});
  const members = properties.map(
    ([key, property]) => `  readonly ${propertyName(key)}?: ${schemaType(property, `${name}${pascalCase(key)}`)};`,
  );
  return `export type ${name} = {
${members.join('\n')}
};
`;
}

export function renderExtensionIdentity(packageJson: PackageManifest): string {
  return (
    `export const extensionIdentity = {\n` +
    `  name: ${quote(packageJson.name)},\n` +
    `  publisher: ${quote(packageJson.publisher ?? '')},\n` +
    `  id: ${quote(`${packageJson.publisher}.${packageJson.name}`)},\n` +
    `  displayName: ${quote(packageJson.displayName ?? '')},\n` +
    `  version: ${quote(packageJson.version ?? '')},\n` +
    `  repository: { type: ${quote(packageJson.repository?.type ?? 'git')}, url: ${quote(packageJson.repository?.url ?? '')} },\n` +
    `  configurationNamespace: ${quote(packageJson.name)},\n` +
    `} as const;\n`
  );
}

function nlsKey(label: string | undefined, description: string): string {
  if (label === undefined || !label.startsWith('%') || !label.endsWith('%')) {
    throw new Error(`${description} must use a %...% NLS reference`);
  }
  return label.slice(1, -1);
}

export function renderCommandContributions(packageJson: PackageManifest): string {
  const entries = packageJson.contributes.commands.map((command) => {
    const titleKey = nlsKey(command.title, `Command ${command.command}`);
    const category = command.category === undefined ? '' : `\n    category: ${quote(command.category)},`;
    return `  ${quote(command.command)}: {\n    titleKey: ${quote(titleKey)},${category}\n  },`;
  });
  const commandIds = packageJson.contributes.commands.map(({ command }) => command);
  const commandIdList = commandIds.map((command) => `  ${quote(command)},`);

  return (
    `export const commandContributions = {\n${entries.join('\n')}\n} as const;\n\n` +
    `export const publicCommandIds = [\n${commandIdList.join('\n')}\n] as const;\n\n` +
    `export type CommandId = (typeof publicCommandIds)[number];\n`
  );
}

export function renderSubmenuContributions(packageJson: PackageManifest): string {
  const submenus = packageJson.contributes.submenus ?? [];
  const entries = submenus.map((submenu) => {
    const labelKey = nlsKey(submenu.label, `Submenu ${submenu.id}`);
    return `  ${quote(submenu.id)}: { labelKey: ${quote(labelKey)} },`;
  });
  return (
    `export const submenuContributions = {\n${entries.join('\n')}\n} as const;\n\n` +
    `export type SubmenuId = keyof typeof submenuContributions;\n`
  );
}

export function renderCustomEditorContributions(packageJson: PackageManifest): string {
  const customEditors = packageJson.contributes.customEditors ?? [];
  const entries = customEditors.map((editor) => {
    const displayNameKey = nlsKey(editor.displayName, `Custom editor ${editor.viewType}`);
    const selectors = editor.selector ?? [];
    const selectorEntries = selectors.map((selector) => {
      const parts = [];
      if (selector.filenamePattern !== undefined) {
        parts.push(`filenamePattern: ${quote(selector.filenamePattern)}`);
      }
      if (selector.filename !== undefined) {
        parts.push(`filename: ${quote(selector.filename)}`);
      }
      return `{ ${parts.join(', ')} }`;
    });
    return `  ${quote(editor.viewType)}: {\n    displayNameKey: ${quote(
      displayNameKey,
    )},\n    priority: ${quote(editor.priority ?? 'default')},\n    selectors: [${selectorEntries.join(', ')}],\n  },`;
  });
  return `export const customEditorContributions = {\n${entries.join('\n')}\n} as const;\n`;
}

export function renderExternalToolTimeoutKeys(packageJson: PackageManifest, extensionPrefix: string): string {
  const keys = Object.keys(packageJson.contributes.configuration.properties)
    .map((fullKey) => fullKey.slice(extensionPrefix.length))
    .filter((key) => /^externalTools\.[A-Za-z]+\.timeoutSeconds$/u.test(key))
    .toSorted();
  const entries = keys.map((key) => {
    const tool = key.slice('externalTools.'.length, -'.timeoutSeconds'.length);
    return `  ${tool}: ${quote(key)},`;
  });
  return `export const externalToolTimeoutConfigurationKeys = {\n${entries.join('\n')}\n} as const;\n`;
}

function assertExtensionIdentity(packageJson: PackageManifest): void {
  if (
    packageJson.publisher === undefined ||
    packageJson.displayName === undefined ||
    packageJson.version === undefined
  ) {
    throw new Error('package.json must define publisher, displayName, and version for the extension identity');
  }
  if (packageJson.repository?.url === undefined) {
    throw new Error('package.json must define repository.url for the extension identity');
  }
}

function assertNoDuplicateIds(ids: readonly unknown[], description: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${description} contains duplicate IDs`);
  }
}

function validateMenus(
  packageJson: PackageManifest,
  configurationProperties: Record<string, JsonSchema>,
  extensionPrefix: string,
): void {
  const commandIds = new Set(packageJson.contributes.commands.map(({ command }) => command));
  const submenuIds = new Set((packageJson.contributes.submenus ?? []).map(({ id }) => id));
  for (const [menuId, entries] of Object.entries(packageJson.contributes.menus ?? {})) {
    const seenTargets = new Set<string>();
    for (const entry of entries) {
      if (entry.command !== undefined && !commandIds.has(entry.command)) {
        throw new Error(`Menu ${menuId} references undefined command ${entry.command}`);
      }
      if (entry.submenu !== undefined && !submenuIds.has(entry.submenu)) {
        throw new Error(`Menu ${menuId} references undefined submenu ${entry.submenu}`);
      }
      const target = entry.command ?? entry.submenu;
      if (target !== undefined) {
        const signature = `${entry.when ?? ''}:${target}`;
        if (seenTargets.has(signature)) {
          throw new Error(`Menu ${menuId} contains a duplicate entry for ${target}`);
        }
        seenTargets.add(signature);
      }
      validateWhenClause(entry.when, menuId, configurationProperties, extensionPrefix);
    }
  }
}

export function validateManifest(packageJson: PackageManifest, extensionPrefix: string): void {
  assertExtensionIdentity(packageJson);

  const commandIds = packageJson.contributes.commands.map(({ command }) => command);
  assertNoDuplicateIds(commandIds, 'contributes.commands');

  const submenuIds = (packageJson.contributes.submenus ?? []).map(({ id }) => id);
  assertNoDuplicateIds(submenuIds, 'contributes.submenus');
  for (const submenuId of submenuIds) {
    if (!submenuId.startsWith(extensionPrefix)) {
      throw new Error(`Submenu ID is outside the extension namespace: ${submenuId}`);
    }
  }

  const customEditorViewTypes = (packageJson.contributes.customEditors ?? []).map((editor) => editor.viewType);
  assertNoDuplicateIds(customEditorViewTypes, 'contributes.customEditors');
  for (const editor of packageJson.contributes.customEditors ?? []) {
    if (!editor.viewType.startsWith(extensionPrefix)) {
      throw new Error(`Custom editor viewType is outside the extension namespace: ${editor.viewType}`);
    }
    nlsKey(editor.displayName, `Custom editor ${editor.viewType}`);
    const priority = editor.priority ?? 'default';
    if (priority !== 'default' && priority !== 'option') {
      throw new Error(`Custom editor ${editor.viewType} has an invalid priority: ${String(priority)}`);
    }
    if (editor.selector === undefined || editor.selector.length === 0) {
      throw new Error(`Custom editor ${editor.viewType} must declare at least one selector.`);
    }
    for (const selector of editor.selector) {
      if (selector.filenamePattern === undefined && selector.filename === undefined) {
        throw new Error(`Custom editor ${editor.viewType} selector must match a filename pattern.`);
      }
    }
  }

  validateMenus(packageJson, packageJson.contributes.configuration.properties, extensionPrefix);
}

function validateWhenClause(
  when: string | undefined,
  menuId: string,
  configurationProperties: Record<string, JsonSchema>,
  extensionPrefix: string,
): void {
  if (when === undefined) {
    return;
  }
  const configReferences = when.match(/config\.([A-Za-z0-9._-]+)/gu) ?? [];
  for (const reference of configReferences) {
    const key = reference.slice('config.'.length);
    if (!key.startsWith(extensionPrefix)) {
      throw new Error(`Menu ${menuId} when clause references config outside the namespace: ${key}`);
    }
    if (!Object.hasOwn(configurationProperties, key)) {
      throw new Error(`Menu ${menuId} when clause references undefined config key ${key}`);
    }
  }
}

export function generate(packageJson: PackageManifest): string {
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
  validateManifest(packageJson, extensionPrefix);

  const configurationKeys = configurationEntries.map(
    ([fullKey]) => `  | ${quote(fullKey.slice(extensionPrefix.length))}`,
  );
  // oxlint-disable eslint/prefer-template -- The generated metadata is deliberately built from concatenated fragments.
  const metadata =
    `// This file is generated by scripts/generate-extension-meta.ts.\n// Do not edit it directly; change package.json and regenerate it.\n\n` +
    renderExtensionIdentity(packageJson) +
    '\n' +
    `type ConfigurationKey =\n${configurationKeys.join('\n')};\n\n` +
    `export type ConfigurationReader = {\n  get(key: string): unknown;\n};\n\n` +
    `type ConfigurationGetter<Value> = () => Value;\n\n` +
    `type ConfigurationSchemaType = 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';\n\n` +
    `type ConfigurationSchema = {\n  types: readonly ConfigurationSchemaType[];\n  enumValues?: readonly (string | number | boolean | null)[];\n  minimum?: number;\n  maximum?: number;\n  minLength?: number;\n  items?: ConfigurationSchema;\n  properties?: Readonly<Record<string, ConfigurationSchema>>;\n  additionalProperties?: boolean;\n};\n\n` +
    `function isConfigurationObject(value: unknown): value is Record<string, unknown> {\n  return typeof value === 'object' && value !== null && !Array.isArray(value);\n}\n\n` +
    `function isNumberWithinBounds(value: number, schema: ConfigurationSchema): boolean {\n  return (\n    (schema.minimum === undefined || value >= schema.minimum) &&\n    (schema.maximum === undefined || value <= schema.maximum)\n  );\n}\n\n` +
    `function matchesConfigurationObject(value: unknown, schema: ConfigurationSchema): boolean {\n  if (!isConfigurationObject(value)) {\n    return false;\n  }\n\n  for (const [key, propertyValue] of Object.entries(value)) {\n    const propertySchema = schema.properties?.[key];\n    if (propertySchema === undefined) {\n      if (schema.additionalProperties === false) {\n        return false;\n      }\n      continue;\n    }\n    if (!matchesConfigurationSchema(propertyValue, propertySchema)) {\n      return false;\n    }\n  }\n\n  return true;\n}\n\n` +
    `function matchesConfigurationType(value: unknown, type: ConfigurationSchemaType, schema: ConfigurationSchema): boolean {\n  switch (type) {\n    case 'array': {\n      if (!Array.isArray(value)) {\n        return false;\n      }\n      const { items } = schema;\n      return items === undefined || value.every((item) => matchesConfigurationSchema(item, items));\n    }\n    case 'boolean': {\n      return typeof value === 'boolean';\n    }\n    case 'integer': {\n      return typeof value === 'number' && Number.isInteger(value) && isNumberWithinBounds(value, schema);\n    }\n    case 'number': {\n      return typeof value === 'number' && Number.isFinite(value) && isNumberWithinBounds(value, schema);\n    }\n    case 'object': {\n      return matchesConfigurationObject(value, schema);\n    }\n    case 'string': {\n      return typeof value === 'string' && (schema.minLength === undefined || value.length >= schema.minLength);\n    }\n    default: {\n      return false;\n    }\n  }\n}\n\n` +
    `function matchesConfigurationSchema(value: unknown, schema: ConfigurationSchema): boolean {\n  if (!schema.types.some((type) => matchesConfigurationType(value, type, schema))) {\n    return false;\n  }\n  return schema.enumValues === undefined || schema.enumValues.some((candidate) => candidate === value);\n}\n\n` +
    renderConfigurationSchemas(configurationEntries, extensionPrefix) +
    `function assertConfigurationValue<Value>(key: ConfigurationKey, value: unknown, defaultValue: Value): Value {\n  if (matchesConfigurationSchema(value, configurationSchemas[key])) {\n    return value as Value;\n  }\n  // 不正な設定値で拡張の起動を止めず、デフォルトへフォールバックする。\n  // 1つのstale設定が全コマンドを無効化するのを防ぐ。\n  console.warn(\n    \`graphics-workbench.\${key}: invalid value \${JSON.stringify(value)}, using default \${JSON.stringify(defaultValue)}\`,\n  );\n  return defaultValue;\n}\n\n` +
    `function defineConfiguration<Value>(\n  configurationReader: ConfigurationReader,\n  key: ConfigurationKey,\n  defaultValue: Value,\n): ConfigurationGetter<Value> {\n` +
    `  return (): Value => {\n    const value = configurationReader.get(key);\n    if (value === undefined) {\n      return defaultValue;\n    }\n    return assertConfigurationValue(key, value, defaultValue);\n  };\n` +
    `}\n\n` +
    objectTypes.map(({ name, schema }) => renderObjectType(name, schema)).join('\n') +
    renderCommandContributions(packageJson) +
    '\n' +
    renderSubmenuContributions(packageJson) +
    '\n' +
    renderCustomEditorContributions(packageJson) +
    '\n' +
    renderExternalToolTimeoutKeys(packageJson, extensionPrefix) +
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
  // oxlint-enable eslint/prefer-template
  return metadata;
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

if (process.argv.length > 1 && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const generated = generate(readPackageManifest());
  if (checkOnly) {
    const metadataIsCurrent = checkGeneratedFile(metadataOutputPath, generated);
    if (!metadataIsCurrent) {
      process.stderr.write('Generated extension metadata is out of date. Run npm run generate:extension-meta.\n');
      process.exitCode = 1;
    }
  } else {
    mkdirSync(path.dirname(metadataOutputPath), { recursive: true });
    writeFileSync(metadataOutputPath, generated);
  }
}
