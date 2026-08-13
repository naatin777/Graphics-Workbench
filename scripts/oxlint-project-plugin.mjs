import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const maxConditionalSpreadsPerObject = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      tooMany:
        'Multiple conditional spreads make the object shape difficult to follow. ' +
        'Prefer an explicitly constructed object.',
    },
  },

  create(context) {
    return {
      ObjectExpression(node) {
        const conditionalSpreads = node.properties.filter((property) => {
          if (property.type !== 'SpreadElement') {
            return false;
          }

          const argument = property.argument;

          return argument.type === 'LogicalExpression' && (argument.operator === '&&' || argument.operator === '||');
        });

        if (conditionalSpreads.length <= 1) {
          return;
        }

        context.report({
          node: conditionalSpreads[1],
          messageId: 'tooMany',
        });
      },
    };
  },
};

const MAX_FLAT_TYPE_MEMBERS = 10;
const IGNORED_GROUP_TOKENS = new Set([
  'data',
  'error',
  'id',
  'input',
  'name',
  'on',
  'output',
  'path',
  'run',
  'src',
  'type',
  'url',
  'value',
]);

function splitIdentifierIntoTokens(name) {
  return name
    .replaceAll(/([a-z\d])([A-Z])/gu, '$1 $2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[^A-Za-z\d]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function normalizeGroupToken(token) {
  return token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token;
}

function getTypeMemberName(member) {
  if (!('key' in member) || member.computed) {
    return undefined;
  }

  if (member.key.type === 'Identifier') {
    return member.key.name;
  }

  return member.key.type === 'Literal' && typeof member.key.value === 'string' ? member.key.value : undefined;
}

function findCandidateGroups(members) {
  const groups = new Map();

  for (const member of members) {
    const name = getTypeMemberName(member);
    if (name === undefined) {
      continue;
    }

    for (const rawToken of splitIdentifierIntoTokens(name)) {
      const token = normalizeGroupToken(rawToken);
      if (IGNORED_GROUP_TOKENS.has(token)) {
        continue;
      }

      const group = groups.get(token) ?? new Set();
      group.add(name);
      groups.set(token, group);
    }
  }

  return [...groups.entries()]
    .filter(([, names]) => names.size >= 2)
    .toSorted((left, right) => right[1].size - left[1].size)
    .slice(0, 3)
    .map(([token, names]) => `${token} (${names.size})`);
}

const maxFlatTypeMembers = {
  meta: {
    type: 'suggestion',
    schema: [],
  },

  create(context) {
    function reportIfTooFlat(node, members, name) {
      if (members.length < MAX_FLAT_TYPE_MEMBERS) {
        return;
      }

      const candidateGroups = findCandidateGroups(members);
      const groupHint = candidateGroups.length > 0 ? ` Candidate groups: ${candidateGroups.join(', ')}.` : '';
      context.report({
        node,
        message:
          `Type ${name} has ${members.length} direct members. ` +
          'Consider grouping related members into nested objects instead of extending this flat shape.' +
          groupHint,
      });
    }

    return {
      TSInterfaceDeclaration(node) {
        reportIfTooFlat(node, node.body.body, node.id.name);
      },
      TSTypeLiteral(node) {
        const parentName =
          node.parent?.type === 'TSTypeAliasDeclaration' && node.parent.id?.type === 'Identifier'
            ? node.parent.id.name
            : 'object type';
        reportIfTooFlat(node, node.members, parentName);
      },
    };
  },
};

const forbidRasterInputLimitBypass = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bypass:
        'Use the shared path-based raster input helper; do not bypass Sharp input limits or configure input channels directly.',
    },
  },

  create(context) {
    const sharpAliases = new Set();

    return {
      VariableDeclarator(node) {
        if (node.id?.type === 'Identifier' && node.init?.type === 'Identifier' && node.init.name === 'sharp') {
          sharpAliases.add(node.id.name);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          (node.callee.name !== 'sharp' && !sharpAliases.has(node.callee.name))
        ) {
          return;
        }

        const input = node.arguments[0];
        const options = node.arguments[1];
        if (options?.type !== 'ObjectExpression') {
          return;
        }

        let hasLimitInputPixels = false;
        let bypassesLimit = false;
        for (const property of options.properties) {
          if (property.type !== 'Property' || property.computed) {
            continue;
          }

          let key;
          if (property.key.type === 'Identifier') {
            key = property.key.name;
          } else if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
            key = property.key.value;
          }
          if (key === 'limitInputPixels') {
            hasLimitInputPixels = true;
            if (property.value.type === 'Literal' && property.value.value === false) {
              bypassesLimit = true;
            }
          }
          if (key === 'unlimited' && property.value.type === 'Literal' && property.value.value === true) {
            bypassesLimit = true;
          }
          if (key === 'limitInputChannels') {
            bypassesLimit = true;
          }
        }

        const inputName = input?.type === 'Identifier' ? String(input.name) : '';
        const isBufferLikeInput = /(?:buffer|data)/iu.test(inputName);
        const readsFileDirectly =
          input?.type === 'AwaitExpression' &&
          input.argument.type === 'CallExpression' &&
          input.argument.callee.type === 'Identifier' &&
          input.argument.callee.name === 'readFile';

        if (bypassesLimit || (hasLimitInputPixels && (isBufferLikeInput || readsFileDirectly))) {
          context.report({ node, messageId: 'bypass' });
        }
      },
    };
  },
};

function isFixedE2EWaitCall(node) {
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') {
    return false;
  }

  const property = node.callee.property;
  const propertyName = property?.type === 'Identifier' ? property.name : property?.value;
  return propertyName === 'waitForTimeout';
}

const noFixedE2EWait = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      fixedWait: 'Do not use fixed Playwright waits. Wait for an observable UI state or animation frame instead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (isFixedE2EWaitCall(node)) {
          context.report({ node, messageId: 'fixedWait' });
        }
      },
    };
  },
};

function normalizeFilename(filename) {
  return filename.replaceAll('\\', '/');
}

function getContextFilename(context) {
  if (typeof context.filename === 'string') {
    return normalizeFilename(context.filename);
  }

  if (typeof context.getFilename === 'function') {
    return normalizeFilename(context.getFilename());
  }

  return '';
}

function isWebviewAppSourceFile(filename) {
  return /(?:^|\/)webview\/src\/pages\/[^/]+\/.+\.(?:ts|tsx)$/u.test(normalizeFilename(filename));
}

function isProcessProtocolFile(filename) {
  return /(?:^|\/)vscode\/extension\/src\/adapters\/crop\/[^/]*process_protocol\.ts$/u.test(
    normalizeFilename(filename),
  );
}

function isAllowedChildProcessFile(filename) {
  const normalized = normalizeFilename(filename);
  if (normalized === '.vscode-test.mjs' || normalized.endsWith('/.vscode-test.mjs')) {
    return true;
  }

  if (/(?:^|\/)(?:scripts|test|vscode\/webview)\//u.test(normalized)) {
    return true;
  }

  return /(?:^|\/)core\/src\/operations\/external_tools\/[^/]+\.ts$/u.test(normalized);
}

function getStaticPropertyName(node) {
  if (node?.type === 'Identifier') {
    return node.name;
  }

  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }

  return undefined;
}

function getMemberPropertyName(node) {
  return node?.type === 'MemberExpression' ? getStaticPropertyName(node.property) : undefined;
}

function isWindowEventCall(node, methodName) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'window' &&
    getMemberPropertyName(node.callee) === methodName &&
    getStaticPropertyName(node.arguments[0]) === 'message'
  );
}

function getEventListenerKey(node) {
  return node?.type === 'Identifier' ? `identifier:${node.name}` : undefined;
}

const requireWebviewListenerCleanup = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missingCleanup:
        'Every window message listener in a Webview app must be removed with the same handler during cleanup.',
    },
  },

  create(context) {
    if (!isWebviewAppSourceFile(getContextFilename(context))) {
      return {};
    }

    const listeners = new Map();
    const removedListeners = new Set();

    return {
      CallExpression(node) {
        if (isWindowEventCall(node, 'addEventListener')) {
          const key = getEventListenerKey(node.arguments[1]);
          if (key === undefined) {
            context.report({ node, messageId: 'missingCleanup' });
            return;
          }

          listeners.set(key, node);
          return;
        }

        if (isWindowEventCall(node, 'removeEventListener')) {
          const key = getEventListenerKey(node.arguments[1]);
          if (key !== undefined) {
            removedListeners.add(key);
          }
        }
      },
      'Program:exit'() {
        for (const [key, node] of listeners) {
          if (!removedListeners.has(key)) {
            context.report({ node, messageId: 'missingCleanup' });
          }
        }
      },
    };
  },
};

const noWebviewApiBypass = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bypass: 'Use the app-local vscode.sendMessage wrapper instead of the raw VS Code Webview API.',
    },
  },

  create(context) {
    const filename = getContextFilename(context);
    if (!isWebviewAppSourceFile(filename) || filename.endsWith('/vscode.ts')) {
      return {};
    }

    return {
      Identifier(node) {
        if (node.name === 'acquireVsCodeApi') {
          context.report({ node, messageId: 'bypass' });
        }
      },
      MemberExpression(node) {
        if (getMemberPropertyName(node) === 'postMessage') {
          context.report({ node, messageId: 'bypass' });
        }
      },
    };
  },
};

const PROCESS_ENVELOPE_FIELDS = ['type', 'protocolVersion', 'requestId'];
const PROCESS_DECLARATION_SUFFIX = /(?:ProcessRequest|ProcessStarted|ProcessSuccess|ProcessFailure)$/u;

function collectTypeMemberNames(node, names = new Set()) {
  if (node?.type === 'TSInterfaceDeclaration') {
    for (const member of node.body.body) {
      const name = getStaticPropertyName(member.key);
      if (name !== undefined) {
        names.add(name);
      }
    }
    return names;
  }

  if (node?.type === 'TSTypeAliasDeclaration') {
    return collectTypeMemberNames(node.typeAnnotation, names);
  }

  if (node?.type === 'TSTypeLiteral') {
    for (const member of node.members) {
      const name = getStaticPropertyName(member.key);
      if (name !== undefined) {
        names.add(name);
      }
    }
    return names;
  }

  if (node?.type === 'TSIntersectionType' || node?.type === 'TSUnionType') {
    for (const type of node.types) {
      collectTypeMemberNames(type, names);
    }
  }

  return names;
}

function getMissingProcessEnvelopeFields(node) {
  const names = collectTypeMemberNames(node);
  return PROCESS_ENVELOPE_FIELDS.filter((field) => !names.has(field));
}

const requireProcessEnvelope = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missingEnvelope:
        'Process protocol types must include type, protocolVersion, and requestId so messages can be correlated and versioned.',
    },
  },

  create(context) {
    if (!isProcessProtocolFile(getContextFilename(context))) {
      return {};
    }

    function checkDeclaration(node) {
      if (!PROCESS_DECLARATION_SUFFIX.test(node.id.name)) {
        return;
      }

      const missing = getMissingProcessEnvelopeFields(node);
      if (missing.length > 0) {
        context.report({ node, messageId: 'missingEnvelope' });
      }
    }

    return {
      TSInterfaceDeclaration: checkDeclaration,
      TSTypeAliasDeclaration: checkDeclaration,
    };
  },
};

const FORBIDDEN_PROCESS_PAYLOAD_FIELDS = new Set(['buffer', 'bytes', 'content', 'data', 'pdfBytes']);

function isForbiddenProcessPayloadField(node) {
  return FORBIDDEN_PROCESS_PAYLOAD_FIELDS.has(getStaticPropertyName(node.key));
}

const noPdfBytesInProcessIpc = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      rawBytes: 'PDF process IPC must pass file paths and metadata, never PDF bytes or buffer-like payloads.',
    },
  },

  create(context) {
    if (!isProcessProtocolFile(getContextFilename(context))) {
      return {};
    }

    return {
      Property(node) {
        if (isForbiddenProcessPayloadField(node)) {
          context.report({ node, messageId: 'rawBytes' });
        }
      },
      TSPropertySignature(node) {
        if (isForbiddenProcessPayloadField(node)) {
          context.report({ node, messageId: 'rawBytes' });
        }
      },
    };
  },
};

const SENSITIVE_IDENTIFIER =
  /access[-_]?key|api[-_]?key|credential|job[-_]?json|password|private[-_]?key|secret|token/iu;

function isSensitiveName(name) {
  const match = name.match(SENSITIVE_IDENTIFIER);
  if (match === null || match.index === undefined) {
    return false;
  }

  const nextCharacter = name[match.index + match[0].length];
  return nextCharacter === undefined || /[A-Z_-]/u.test(nextCharacter);
}

function hasSensitiveIdentifier(node, visited = new Set()) {
  if (node === null || typeof node !== 'object' || visited.has(node)) {
    return false;
  }
  visited.add(node);

  if (node.type === 'Identifier' && isSensitiveName(node.name)) {
    return true;
  }

  if (node.type === 'MemberExpression' && isSensitiveName(getMemberPropertyName(node) ?? '')) {
    return true;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.some((child) => hasSensitiveIdentifier(child, visited))) {
        return true;
      }
    } else if (hasSensitiveIdentifier(value, visited)) {
      return true;
    }
  }

  return false;
}

const noSecretOutputLog = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      secret: 'Do not write secret-like values or job JSON paths directly to an OutputChannel.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (getMemberPropertyName(node.callee) !== 'appendLine') {
          return;
        }

        if (hasSensitiveIdentifier(node.arguments[0])) {
          context.report({ node, messageId: 'secret' });
        }
      },
    };
  },
};

function isChildProcessSource(node) {
  return node?.type === 'Literal' && (node.value === 'child_process' || node.value === 'node:child_process');
}

const noDirectChildProcess = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      boundary: 'Direct child_process access is restricted to the shared external-tool and process-runner adapters.',
    },
  },

  create(context) {
    if (isAllowedChildProcessFile(getContextFilename(context))) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (isChildProcessSource(node.source)) {
          context.report({ node, messageId: 'boundary' });
        }
      },
      ImportExpression(node) {
        if (isChildProcessSource(node.source)) {
          context.report({ node, messageId: 'boundary' });
        }
      },
      CallExpression(node) {
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'require' &&
          isChildProcessSource(node.arguments[0])
        ) {
          context.report({ node, messageId: 'boundary' });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Package boundary rules (moved from scripts/check-package-boundaries.mjs):
// architecture rules that inspect import declarations and file locations.
// Package metadata (dependency ownership, versions, exports, lockfiles) stays
// in the standalone script.
// ---------------------------------------------------------------------------

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const workspacePackages = [
  {
    name: 'core',
    root: path.join(repositoryRoot, 'core'),
    packageJson: readJsonFile(path.join(repositoryRoot, 'core', 'package.json')),
  },
  {
    name: 'vscode',
    root: path.join(repositoryRoot, 'vscode', 'extension'),
    packageJson: readJsonFile(path.join(repositoryRoot, 'vscode', 'extension', 'package.json')),
  },
  {
    name: 'protocol',
    root: path.join(repositoryRoot, 'vscode', 'protocol'),
    packageJson: readJsonFile(path.join(repositoryRoot, 'vscode', 'protocol', 'package.json')),
  },
  {
    name: 'webview',
    root: path.join(repositoryRoot, 'vscode', 'webview'),
    packageJson: readJsonFile(path.join(repositoryRoot, 'vscode', 'webview', 'package.json')),
  },
  {
    name: 'tui',
    root: path.join(repositoryRoot, 'tui'),
    packageJson: readJsonFile(path.join(repositoryRoot, 'tui', 'package.json')),
  },
];

const publicCoreEntries = new Set(
  Object.keys(workspacePackages[0].packageJson.exports ?? {})
    .filter((entry) => entry.startsWith('./'))
    .map((entry) => entry.slice(2)),
);

function resolveContextFilePath(context) {
  return path.resolve(context.cwd, context.filename);
}

function findWorkspacePackage(filePath) {
  const normalized = normalizeFilename(path.resolve(filePath));
  let best;
  for (const workspacePackage of workspacePackages) {
    const root = normalizeFilename(workspacePackage.root);
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      if (best === undefined || workspacePackage.root.length > best.root.length) {
        best = workspacePackage;
      }
    }
  }
  return best;
}

function packageNameFor(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function importSourceOf(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

function importSpecifierVisitors(onSpecifier) {
  const handleDeclaration = (node) => {
    const source = importSourceOf(node.source);
    if (source !== undefined) {
      onSpecifier(source, node);
    }
  };
  return {
    ImportDeclaration: handleDeclaration,
    ExportNamedDeclaration: handleDeclaration,
    ExportAllDeclaration: handleDeclaration,
    ImportExpression(node) {
      const source = importSourceOf(node.source);
      if (source !== undefined) {
        onSpecifier(source, node);
      }
    },
    CallExpression(node) {
      if (node.callee?.type === 'Identifier' && node.callee.name === 'require') {
        const source = importSourceOf(node.arguments[0]);
        if (source !== undefined) {
          onSpecifier(source, node);
        }
      }
    },
  };
}

const noFrontendTerminologyInCore = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    if (!/(?:^|\/)core\/(?:src|testing)\//u.test(normalizeFilename(context.filename))) {
      return {};
    }

    return {
      Program(node) {
        if (/\b(?:VS Code|Terminal UI|TUI|Extension Host)\b/u.test(context.sourceCode.text)) {
          context.report({
            node,
            message: 'core source contains frontend-specific policy terminology.',
          });
        }
      },
    };
  },
};

const noFrontendPackageInCore = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    if (!/(?:^|\/)core\/(?:src|testing)\//u.test(normalizeFilename(context.filename))) {
      return {};
    }

    return importSpecifierVisitors((specifier, node) => {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) {
        return;
      }
      const packageName = packageNameFor(specifier);
      if (
        packageName === 'vscode' ||
        packageName === 'bun' ||
        packageName === 'bun-types' ||
        packageName.startsWith('@opentui/')
      ) {
        context.report({ node, message: `core imports frontend-only package ${specifier}` });
      }
    });
  },
};

const noUndeclaredImports = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    const workspacePackage = findWorkspacePackage(resolveContextFilePath(context));
    if (workspacePackage === undefined) {
      return {};
    }

    const declaredDependencies = new Set([
      ...Object.keys(workspacePackage.packageJson.dependencies ?? {}),
      ...Object.keys(workspacePackage.packageJson.devDependencies ?? {}),
    ]);
    const allowedBarePackages =
      workspacePackage.name === 'vscode' ? ['vscode'] : workspacePackage.name === 'webview' ? ['@webview-shared'] : [];

    return importSpecifierVisitors((specifier, node) => {
      if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier.startsWith('bun:')) {
        return;
      }
      if (packageNameFor(specifier) === workspacePackage.packageJson.name) {
        return;
      }
      if (allowedBarePackages.some((allowed) => specifier === allowed || specifier.startsWith(`${allowed}/`))) {
        return;
      }
      const packageName = packageNameFor(specifier);
      if (!declaredDependencies.has(packageName)) {
        context.report({ node, message: `imports undeclared ${workspacePackage.name} dependency ${specifier}` });
      }
    });
  },
};

const noNonPublicCoreImports = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    if (findWorkspacePackage(resolveContextFilePath(context)) === undefined) {
      return {};
    }

    const packagePrefix = '@graphics-workbench/core/';
    return importSpecifierVisitors((specifier, node) => {
      if (!specifier.startsWith(packagePrefix)) {
        return;
      }
      const entry = specifier.slice(packagePrefix.length);
      if (!publicCoreEntries.has(entry)) {
        context.report({ node, message: `imports non-public core module ${specifier}` });
      }
    });
  },
};

const noCrossFrontendImports = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    const filePath = normalizeFilename(resolveContextFilePath(context));
    const vscodeSourceRoot = normalizeFilename(path.join(repositoryRoot, 'vscode', 'extension'));
    const tuiSourceRoot = normalizeFilename(path.join(repositoryRoot, 'tui'));
    const webviewSourceRoot = normalizeFilename(path.join(repositoryRoot, 'vscode', 'webview'));

    let forbiddenPackage;
    let forbiddenSourceRoot;
    if (filePath.startsWith(`${vscodeSourceRoot}/`)) {
      forbiddenPackage = 'graphics-workbench-tui';
      forbiddenSourceRoot = tuiSourceRoot;
    } else if (filePath.startsWith(`${tuiSourceRoot}/`)) {
      forbiddenPackage = 'vscode';
      forbiddenSourceRoot = vscodeSourceRoot;
    } else if (filePath.startsWith(`${webviewSourceRoot}/`)) {
      forbiddenPackage = 'vscode';
      forbiddenSourceRoot = vscodeSourceRoot;
    } else {
      return {};
    }

    return importSpecifierVisitors((specifier, node) => {
      if (specifier === forbiddenPackage || specifier.startsWith(`${forbiddenPackage}/`)) {
        context.report({ node, message: `imports ${forbiddenPackage} package` });
        return;
      }
      if (!specifier.startsWith('.') || forbiddenSourceRoot === undefined) {
        return;
      }
      const resolved = normalizeFilename(path.resolve(path.dirname(filePath), specifier));
      if (resolved === forbiddenSourceRoot || resolved.startsWith(`${forbiddenSourceRoot}/`)) {
        context.report({ node, message: `reaches forbidden frontend source through ${specifier}` });
      }
    });
  },
};

const noExportStarInCorePublic = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    if (!/(?:^|\/)core\/src\/public\/[^/]+\.ts$/u.test(normalizeFilename(context.filename))) {
      return {};
    }

    return {
      ExportAllDeclaration(node) {
        context.report({ node, message: 'core public modules must use named exports instead of export *.' });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// NLS source-code analysis (moved from scripts/check-nls.mjs): the key set
// consistency checks between package.nls.json files stay in the standalone
// script, while userMessage call sites are validated here.
// ---------------------------------------------------------------------------

function readNlsMessages() {
  try {
    return readJsonFile(path.join(repositoryRoot, 'vscode', 'extension', 'package.nls.json'));
  } catch {
    return undefined;
  }
}

const nlsEnglishMessages = readNlsMessages();
const NLS_PLACEHOLDER_PATTERN = /\{(\d+)\}/gu;

function requiredMessageArgumentCount(message) {
  let count = 0;
  for (const match of message.matchAll(NLS_PLACEHOLDER_PATTERN)) {
    count = Math.max(count, Number(match[1]) + 1);
  }
  return count;
}

function validateUserMessageCall(key, argumentCount) {
  if (nlsEnglishMessages === undefined) {
    return [];
  }
  if (!Object.hasOwn(nlsEnglishMessages, key)) {
    return [`userMessage call references missing NLS key ${key}`];
  }
  const requiredArguments = requiredMessageArgumentCount(nlsEnglishMessages[key]);
  if (argumentCount - 1 < requiredArguments) {
    return [`userMessage call has too few arguments for ${key}`];
  }
  return [];
}

const noInvalidUserMessage = {
  meta: {
    type: 'problem',
    schema: [],
  },

  create(context) {
    if (nlsEnglishMessages === undefined) {
      return {};
    }
    if (!/(?:^|\/)vscode\/extension\/src\//u.test(normalizeFilename(context.filename))) {
      return {};
    }

    return {
      CallExpression(node) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'userMessage') {
          return;
        }
        const keyNode = node.arguments[0];
        if (keyNode?.type !== 'Literal' || typeof keyNode.value !== 'string') {
          return;
        }
        for (const message of validateUserMessageCall(keyNode.value, node.arguments.length)) {
          context.report({ node, message });
        }
      },
    };
  },
};

export default {
  meta: {
    name: 'project',
  },

  rules: {
    'max-conditional-spreads-per-object': maxConditionalSpreadsPerObject,
    'max-flat-type-members': maxFlatTypeMembers,
    'forbid-raster-input-limit-bypass': forbidRasterInputLimitBypass,
    'no-fixed-e2e-wait': noFixedE2EWait,
    'no-webview-api-bypass': noWebviewApiBypass,
    'require-webview-listener-cleanup': requireWebviewListenerCleanup,
    'require-process-envelope': requireProcessEnvelope,
    'no-pdf-bytes-in-process-ipc': noPdfBytesInProcessIpc,
    'no-secret-output-log': noSecretOutputLog,
    'no-direct-child-process': noDirectChildProcess,
    'no-frontend-terminology-in-core': noFrontendTerminologyInCore,
    'no-frontend-package-in-core': noFrontendPackageInCore,
    'no-undeclared-imports': noUndeclaredImports,
    'no-nonpublic-core-imports': noNonPublicCoreImports,
    'no-cross-frontend-imports': noCrossFrontendImports,
    'no-export-star-in-core-public': noExportStarInCorePublic,
    'no-invalid-user-message': noInvalidUserMessage,
  },
};

export {
  findCandidateGroups,
  getMissingProcessEnvelopeFields,
  getStaticPropertyName,
  hasSensitiveIdentifier,
  isAllowedChildProcessFile,
  isFixedE2EWaitCall,
  isProcessProtocolFile,
  isWebviewAppSourceFile,
  packageNameFor,
  requiredMessageArgumentCount,
  splitIdentifierIntoTokens,
  validateUserMessageCall,
};
