import xmlFormat from "xml-formatter";

figma.codegen.on("generate", async (event) => {
  const outputType = figma.codegen.preferences.customSettings.outputType;
  let code = "";
  if (outputType === "single") {
    const name = event.node.name;
    const names = getUniqueNodeNames(event.node, {});
    const css = await createCss(event.node, names, false, true);
    const tokens = getTokens(event.node, []);
    const html = await createHtml(event.node, names, false, true);
    code = template([component(name, css, xmlFormat(html), tokens)]);
  } else if (outputType === "multi") {
    const topLevelComponents: SceneNode[] = [];
    function findTopComponents(node: SceneNode) {
      if (isComponent(node)) {
        topLevelComponents.push(node);
      }
      if ("children" in node) {
        node.children.forEach((child) => findTopComponents(child));
      }
    }
    findTopComponents(event.node);

    async function createComponent(node: SceneNode) {
      const name = node.name;
      const names = getUniqueNodeNames(node, {});
      const css = await createCss(node, names, true, true);
      const tokens = getTokens(node, []);
      const html = await createHtml(node, names, true, true);
      return component(name, css, xmlFormat(html), tokens);
    }

    const components = await Promise.all(
      topLevelComponents.map((node) => createComponent(node))
    );

    code = template(components);
  }
  return [
    {
      language: "TYPESCRIPT",
      code,
      title: "Lit Element",
    },
  ];
});

function isComponent(node: SceneNode) {
  return (
    node.type === "COMPONENT" ||
    node.type === "INSTANCE" ||
    node.type === "FRAME"
  );
}

function getTokens(node: SceneNode, tokens: string[]): string[] {
  if ("children" in node) {
    node.children.forEach((child) => getTokens(child, tokens));
  } else if ("characters" in node) {
    // tokens.push(node.characters);
    const str = node.characters;
    if (str.includes("{{") && str.includes("}}")) {
      const results = str.match(/{{(.*?)}}/g);
      if (results) {
        results.forEach((result) => {
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

async function createHtml(
  node: SceneNode,
  names: NameMap,
  multi: boolean,
  root: boolean
): Promise<string> {
  if (multi && isComponent(node) && !root) {
    const name = Object.keys(names).find((key) => names[key] === node)!;
    let props = "";
    const tokens = getTokens(node, []);
    if (tokens.length > 0) {
      for (const token of tokens) {
        props += ` ${token}="\${this.${token}}"`;
      }
    }
    const tag = tagName(name);
    return `<${tag}${props}></${tag}>`;
  }
  const className = Object.keys(names).find((key) => names[key] === node);
  const styles = `class="${className}"`;
  const start = `<div ${styles}>`;
  const end = "</div>";

  if ("children" in node) {
    const children = await Promise.all(
      node.children.map((child) => createHtml(child, names, multi, false))
    );
    return `${start}${children.join("\n")}${end}`;
  }

  if ("characters" in node) {
    let str = node.characters;

    // Replace {{tokens}} with ${this.tokens}
    if (str.includes("{{") && str.includes("}}")) {
      const results = str.match(/{{(.*?)}}/g);
      if (results) {
        results.forEach((result) => {
          const token = propertyName(result.slice(2, -2));
          str = str.replace(result, `\${this.${token}}`);
        });
      }
    }

    return `<span ${styles}>${str}</span>`;
  }

  return `${start}${node.name}${end}`;
}

async function createCss(
  node: SceneNode,
  names: NameMap,
  multi: boolean,
  root: boolean
): Promise<string> {
  if (multi && isComponent(node) && !root) {
    return ``;
  }

  const css = await node.getCSSAsync();

  let result = "";

  const name = Object.keys(names).find((key) => names[key] === node);
  result += `.${name} {\n`;
  for (const key in css) {
    result += `   ${key}: ${css[key]};\n`;
  }
  result += "}\n";

  if ("children" in node) {
    result += await Promise.all(
      node.children.map((child) => createCss(child, names, multi, false))
    ).then((children) => children.join("\n"));
  }

  return result;
}

const template = (body: string[]) =>
  `
import {html, css, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

${body.join("\n\n")}
`.trim();

const component = (name: string, css: string, html: string, tokens: string[]) =>
  `
@customElement('${tagName(name)}')
export class ${className(name)} extends LitElement {
  static styles = css\`
${css}\`;

  ${tokens
    .map((token) => `@property({type: String}) ${token} = '';`)
    .join("\n  ")}

  render() {
    return html\`
${xmlFormat(html)}
\`;
  }
}
`.trim();

function className(str: string) {
  // Convert raw name to PascalCase
  let result = str
    .replace(/^[^a-z]+|[^\w:.-]+/gi, "$")
    .split("$")
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join("");
  if (!result.endsWith("Element")) {
    result += "Element";
  }
  return result;
}

function tagName(str: string) {
  // Convert raw name to kebab-case
  let result = str
    .replace(/^[^a-z]+|[^\w:.-]+/gi, "$")
    .split("$")
    .map((x) => x.toLowerCase())
    .join("-");
  if (!result.endsWith("-element")) {
    result += "-element";
  }
  return result;
}

function propertyName(str: string) {
  // Convert raw name to camelCase
  return str
    .replace(/^[^a-z]+|[^\w:.-]+/gi, "$")
    .split("$")
    .map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x))
    .join("");
}

interface NameMap {
  [key: string]: SceneNode;
}

function getUniqueNodeNames(node: SceneNode, names: NameMap): NameMap {
  if ("children" in node) {
    node.children.forEach((child) => getUniqueNodeNames(child, names));
  }
  let name = tagName(node.name);
  while (names[name]) {
    name += "_";
  }
  names[name] = node;
  return names;
}
