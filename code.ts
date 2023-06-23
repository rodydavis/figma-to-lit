figma.codegen.on('generate', async (event) => {
  const name = event.node.name;
  const names = getUniqueNodeNames(event.node, {});
  const css = await createCss(event.node, names);
  const tokens = getTokens(event.node, []);
  const html = await createHtml(event.node, names);
  let code = template(name, css, html, tokens);
  code = formatCode(code);
  return [
    {
      language: "TYPESCRIPT",
      code,
      title: "Lit Element",
    },
  ];
});

function getTokens(node: SceneNode, tokens: string[]): string[] {
  if ('children' in node) {
    node.children.forEach(child => getTokens(child, tokens));
  } else if ('characters' in node) {
    // tokens.push(node.characters);
    const str = node.characters;
  if (str.includes('{{') && str.includes('}}')) {
      const results = str.match(/{{(.*?)}}/g);
      if (results) {
        results.forEach(result => {
          const token = propertyName(result.slice(2, -2));
          if (tokens.indexOf(token) === -1) {
            tokens.push(token);
          }
        });
      }
    }
  }
  return tokens;
}

async function createCss(node: SceneNode, names: NameMap): Promise<string> {
  const css = await node.getCSSAsync();

  let result = '';

  if ('children' in node) {
    result += await Promise.all(node.children.map(child => createCss(child, names))).then(children => children.join(''));
  }

  const name = Object.keys(names).find(key => names[key] === node);
  result += `.${name} {`;
  for (const key in css) {
    result += `${key}: ${css[key]};`;
  }
  result += '}';

  return result;
}

async function createHtml(node: SceneNode, names: NameMap): Promise<string> {
  const className = Object.keys(names).find(key => names[key] === node);
  const styles = `class="${className}"`;
  const start = `<div ${styles}>`;
  const end = '</div>';

  if ('children' in node) {
    const children = await Promise.all(node.children.map(child => createHtml(child, names)));
    return `${start}${children.join('')}${end}`;
  }

  if ('characters' in node) {
    let str = node.characters;

    // Replace {{tokens}} with ${this.tokens}
    if (str.includes('{{') && str.includes('}}')) {
      const results = str.match(/{{(.*?)}}/g);
      if (results) {
        results.forEach(result => {
          const token = propertyName(result.slice(2, -2));
          str = str.replace(result, `\${this.${token}}`);
        });
      }
    }

    return `<span ${styles}>${str}</span>`;
  }

  return `${start}${node.name}${end}`;
}

const template = (name: string, css: string, html: string, tokens: string[]) => `
import {html, css, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('${tagName(name)}')
export class ${className(name)} extends LitElement {
  static styles = css\`${css}\`;

  ${tokens.map(token => `@property({type: String}) ${token} = '';`).join('\n  ')}

  render() {
    return html\`${html}\`;
  }
}
`.trim();

function className(str: string) {
  // Convert raw name to PascalCase
  let result = str
    .replace(/^[^a-z]+|[^\w:.-]+/gi, '$')
    .split('$')
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join('');
  if (!result.endsWith('Element')) {
    result += 'Element';
  }
  return result;
}

function tagName(str: string) {
  // Convert raw name to kebab-case
  let result = str
    .replace(/^[^a-z]+|[^\w:.-]+/gi, '$')
    .split('$')
    .map((x) => x.toLowerCase())
    .join('-');
  if (!result.endsWith('-element')) {
    result += '-element';
  }
  return result;
}

function propertyName(str: string) {
  // Convert raw name to camelCase
  return str
    .replace(/^[^a-z]+|[^\w:.-]+/gi, '$')
    .split('$')
    .map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x))
    .join('');
}

interface NameMap { [key: string]: SceneNode }

function getUniqueNodeNames(node: SceneNode, names: NameMap): NameMap {
  if ('children' in node) {
    node.children.forEach(child => getUniqueNodeNames(child, names));
  }
  let name = tagName(node.name);
  while (names[name]) {
    name += '_';
  }
  names[name] = node;
  return names;
}


function formatCode(str: string) {
  const regex = /(?<=\n|^)(\s*)(?=\S)/g;

  const formattedCode = str.replace(regex, function (match) {
    return match.toLowerCase();
  });

  return formattedCode;
}