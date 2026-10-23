"""Read explicitly selected source prose with AST only, never render/execute Python."""

import ast
import re
from html.parser import HTMLParser


class PlainProse(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if self.hidden:
            return
        if tag in ('p', 'div', 'section', 'header', 'ul', 'ol', 'table', 'tr', 'br'):
            self.parts.append('\n')
        if tag in ('h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n\n' + '#' * int(tag[1]) + ' ')
        if tag == 'li':
            self.parts.append('\n- ')
        if tag in ('td', 'th'):
            self.parts.append(' | ')
        if tag == 'a':
            href = dict(attrs).get('href', '')
            if re.match(r'^https?://[^\s<>]+$', href):
                self.parts.append(' (' + href + ') ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag in ('p', 'div', 'section', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)

    def markdown(self):
        value = ''.join(self.parts)
        value = re.sub(r'[ \t]+', ' ', value)
        return re.sub(r'\n\s*\n+', '\n\n', value).strip()


def common_prose(source, path):
    tree = ast.parse(source, filename=path)
    entries = []
    inventory = []
    for function in (node for node in tree.body if isinstance(node, ast.FunctionDef)):
        constants = [node for node in ast.walk(function) if isinstance(node, ast.Constant) and isinstance(node.value, str)]
        inventory.append({'function': function.name, 'line': function.lineno, 'endLine': function.end_lineno,
                          'stringLiterals': len(constants),
                          'disposition': 'selected-prose' if function.name in ('build_prepare', 'build_paris_museum_booking')
                          else 'other-renderer-code-review-pending'})
        if function.name not in ('build_prepare', 'build_paris_museum_booking'):
            continue
        selected = []
        if function.name == 'build_paris_museum_booking':
            for node in function.body:
                if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                    if node.targets[0].id in ('wave', 'principles', 'checklist'):
                        selected.append((node.targets[0].id, node.value))
        else:
            for node in ast.walk(function):
                if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Subscript) and isinstance(target.slice, ast.Constant)
                    and target.slice.value == 'emergency.html' for target in node.targets
                ):
                    body = next((kw.value for kw in node.value.keywords if kw.arg == 'body'), None)
                    if body is not None:
                        selected.append(('emergency', body))
        for label, value in selected:
            dynamic = []
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                html = value.value
            elif isinstance(value, ast.JoinedStr):
                parts = []
                for part in value.values:
                    if isinstance(part, ast.Constant):
                        parts.append(part.value)
                    else:
                        # Known static alert prose can be read without executing the helper.
                        expr = part.value
                        if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id == 'alert' and len(expr.args) > 1:
                            try:
                                parts.append(ast.literal_eval(expr.args[1]))
                                continue
                            except (ValueError, TypeError):
                                pass
                        dynamic.append({'line': part.lineno, 'expression': ast.get_source_segment(source, part)})
                html = ''.join(parts)
            else:
                raise ValueError('common prose must be a static string or an explicit f-string')
            parser = PlainProse()
            parser.feed(html)
            locator = f'{path}:{value.lineno}-{value.end_lineno}:prose-{label}'
            titles = {'wave': '예약 진행 순서', 'principles': '예약 원칙', 'checklist': '예약 체크리스트', 'emergency': '긴급 연락처'}
            entries.append({'sourceKind': 'python', 'sourceKey': f'{path}:prose-{label}', 'locator': locator,
                            'status': 'extracted', 'rawValue': {'title': titles[label], 'bodyMd': parser.markdown(),
                                                             'dynamicExpressions': dynamic}})
    return entries, inventory
