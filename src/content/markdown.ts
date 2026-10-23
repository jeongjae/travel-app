type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };

/** Editorial <titles> remain visible text. HTML is never executed; links and code keep their AST meaning. */
export function literalHtml() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'html') {
        node.type = 'text';
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
