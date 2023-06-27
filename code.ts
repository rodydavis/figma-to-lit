import { camelCase, paramCase, pascalCase } from "change-case";
// @ts-ignore
import Mustache from 'mustache';

figma.codegen.on("generate", async (event) => {
  const args = await createTemplate(event.node);
  return [
    {
      language: "TYPESCRIPT",
      code: renderTemplate(args, true),
      title: "Lit (TS)",
    },
    {
      language: "JAVASCRIPT",
      code: renderTemplate(args, false),
      title: "Lit (JS)",
    },
  ];
});

function normalize(str: string) {
  const regex = /[^\w\s]/g;
  return str.replace(regex, '');
}

function className(str: string) {
  // Convert raw name to PascalCase
  let result = normalize(str);
  if (/^\d/.test(str)) {
    result = `X ${result}`;
  }
  if (!result.endsWith("Element")) {
    result += " Element";
  }
  return pascalCase(result);
}

function tagName(str: string) {
  // Convert raw name to kebab-case
  let result = normalize(str.trim());
  if (/^\d/.test(str)) {
    result = `x-${result}`;
  }
  result = paramCase(result);
  if (!result.endsWith("-element")) {
    result += "-element";
  }
  return paramCase(result);
}

function propertyName(str: string) {
  let result = normalize(str);
  if (/^\d/.test(str)) {
    result = `x-${result}`;
  }
  return camelCase(result);
}

const litTSTemplate = `
import {html, css, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

{{#components}}
@customElement('{{tag}}')
export class {{name}} extends LitElement {
  static styles = css\`
  {{#styles}}
  .{{selector}} {
    {{#attributes}}
    {{key}}: {{value}};
    {{/attributes}}
  }
  {{/styles}}
  \`;

  {{#properties}}
  @property({type: {{type}}}) {{name}} = {{value}};
  {{/properties}}

  render() {
    return html\`
{{#xml}}{{node}}{{/xml}}
    \`;
  }
}

{{/components}}
`.trim();

const litJSTemplate = `
import {html, css, LitElement} from 'lit';

{{#components}}
export class {{name}} extends LitElement {
  static styles = css\`
  {{#styles}}
  .{{selector}} {
    {{#attributes}}
    {{key}}: {{value}};
    {{/attributes}}
  }
  {{/styles}}
  \`;

  static properties = {
    {{#properties}}
    {{name}}: {type: {{type}}},
    {{/properties}}
  };

  constructor() {
    super();
    {{#properties}}
    this.{{name}} = {{value}};
    {{/properties}}
  }

  render() {
    return html\`
{{#xml}}{{node}}{{/xml}}
    \`;
  }
}
customElements.define('{{tag}}', {{name}});
{{/components}}
`.trim();

interface LitTemplate {
  components: LitComponent[];
}

interface LitComponent {
  tag: string;
  name: string;
  styles: LitStyle[];
  properties: LitProperty[];
  node: LitNode;
}

interface LitStyle {
  selector: string;
  attributes: LitStyleAttribute[];
}

interface LitStyleAttribute {
  key: string;
  value: string;
}

interface LitProperty {
  type: string;
  name: string;
  value: string;
}

interface LitNode {
  tag: string;
  attributes: LitStyleAttribute[] | null;
  children: LitNode[] | string[] | null;
  component: boolean;
  node: SceneNode,
}

async function createTemplate(node: SceneNode): Promise<LitTemplate> {
  const components: LitComponent[] = [];

  async function addComponent(target: SceneNode) {
    // const globalAttrs = getNodeProperties(target, { recursive: true });
    if (isComponent(target) || target === node) {
      const styles: LitStyle[] = [];
      const properties: LitProperty[] = [];

      async function addStyle(child: SceneNode) {
        if (isComponent(child) && target !== child) return;

        const css = await child.getCSSAsync();
        styles.push({
          selector: tagName(child.name),
          attributes: Object.entries(css).map((([key, value]) => ({ key, value })))
        });

        if ('children' in child) {
          for (const item of child.children) {
            await addStyle(item);
          }
        }
      }

      await addStyle(target);

      const attrs = getNodeProperties(target, { recursive: true });
      for (const [key, value] of Object.entries({ ...attrs })) {
        properties.push({
          type: 'String',
          name: propertyName(key),
          value: typeof value === 'string' ? `'${value}'` : value,
        });
      }

      const component: LitComponent = {
        node: nodeTree(target),
        name: className(target.name),
        tag: tagName(target.name),
        styles,
        properties,
      };
      components.push(component);

      if ('children' in target) {
        for (const child of target.children) {
          await addComponent(child);
        }
      }
    }
  }

  await addComponent(node);

  return { components };
}

function renderXml(node: LitNode) {
  const sb: string[] = [];
  if (node.component) {
    if (node.attributes) {
      sb.push(`<${node.tag} `)
      for (const attr of node.attributes) {
        sb.push(`   ${propertyName(attr.key)}=\${this.${propertyName(attr.key)}} `)
      }
      sb.push(`>`)
    } else {
      sb.push(`<${node.tag}>`)
    }
    sb.push(`</${node.tag}>`)
  } else {
    let element = 'div';
    if ('reactions' in node.node) {
      const reactions = node.node.reactions;
      for (const item of reactions) {
        if (item.trigger) {
          if (
            item.trigger.type === "ON_CLICK" ||
            item.trigger.type === "ON_HOVER" ||
            item.trigger.type === "ON_PRESS" ||
            item.trigger.type === "MOUSE_DOWN"
          ) {
            element = 'button';
          }
        }
      }
    }
    sb.push(`<${element} class="${node.tag}">`)
    if (node.children) {
      for (const child of node.children) {
        if (typeof child === 'string') {
          let bound = false;
          if (node.node.boundVariables?.characters) {
            const variable = figma.variables.getVariableById(node.node.boundVariables.characters.id);
            if (variable) {
              sb.push(`   \${this.${propertyName(variable.name)}}`);
              bound = true;
            }
          } else if (node.node.componentPropertyReferences?.characters) {
            const label = node.node.componentPropertyReferences.characters.split('#')[0];
            sb.push(`   \${this.${propertyName(label)}}`);
            bound = true;
          }
          if (!bound) sb.push(`   ${child}`);
        } else {
          sb.push(`   ${renderXml(child)}`);
        }
      }
    }
    sb.push(`</${element}>`)
  }
  return sb.join('\n');
}

function renderTemplate(args: LitTemplate, typescript: boolean = true) {
  const template = typescript ? litTSTemplate : litJSTemplate;
  Mustache.escape = function (text: string) { return text; };
  return Mustache.render(template, {
    ...args,
    "xml": function () {
      return () => renderXml(this.node);
    }
  });
}

function getNodeProperties(node: SceneNode, options?: {
  recursive?: boolean
}) {
  const attributes: { [key: string]: string } = {};

  if (node.type === 'COMPONENT') {
    const properties = node.componentPropertyDefinitions;
    for (const [key, value] of Object.entries(properties)) {
      const label = key.split('#')[0];
      attributes[label] = `${value.defaultValue}`;
    }
  }
  if (node.type === 'INSTANCE') {
    const properties = node.componentProperties;
    for (const [key, value] of Object.entries(properties)) {
      const label = key.split('#')[0];
      attributes[label] = `${value.value}`;
    }
  }
  if (node.boundVariables) {
    const variables = node.boundVariables!
    if (variables?.characters) {
      const variable = figma.variables.getVariableById(variables.characters.id);
      if (variable) {
        attributes[variable.name] = '';
      }
    }
  }

  const references = node.componentPropertyReferences;
  if (references?.characters) {
    const label = references.characters.split('#')[0];
    attributes[label] = attributes[label] ?? label;
  }

  if (options?.recursive) {
    if ('children' in node) {
      for (const child of node.children) {
        const attrs = getNodeProperties(child, { recursive: true });
        for (const [key, value] of Object.entries(attrs)) {
          attributes[key] = value;
        }
      }
    }
  }

  return attributes;
}

function nodeTree(node: SceneNode, root: boolean = true): LitNode {
  const children: LitNode[] = [];
  const attributes = getNodeProperties(node, { recursive: true });
  if ('children' in node) {
    for (const child of node.children) {
      children.push(nodeTree(child, false));
    }
  }
  const attrs = Object.entries(attributes).map(([key, value]) => ({ key, value }));
  let str: string | null = null;
  if ('characters' in node) {
    str = node.characters;
  }
  return {
    node,
    tag: tagName(node.name),
    children: children.length === 0 ? (str ? [str] : null) : children,
    attributes: attrs.length === 0 ? null : attrs,
    component: isComponent(node) && !root,
  };
}

function isComponent(node: SceneNode) {
  return (
    node.type === "COMPONENT" ||
    node.type === "INSTANCE" ||
    node.type === 'FRAME'
  );
}