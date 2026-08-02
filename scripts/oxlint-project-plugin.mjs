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
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'sharp') {
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

export default {
  meta: {
    name: 'project',
  },

  rules: {
    'max-conditional-spreads-per-object': maxConditionalSpreadsPerObject,
    'max-flat-type-members': maxFlatTypeMembers,
    'forbid-raster-input-limit-bypass': forbidRasterInputLimitBypass,
    'no-fixed-e2e-wait': noFixedE2EWait,
  },
};

export { findCandidateGroups, isFixedE2EWaitCall, splitIdentifierIntoTokens };
