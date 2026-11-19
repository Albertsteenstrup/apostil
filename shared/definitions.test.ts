// Tests of the finder of the code that should have a note: one small made-up file for each family of languages.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { definitionsOf } from './definitions';

/** The definitions of a file as [name, first line, last line], with "test" after a test. */
const found = (path: string, lines: string[]): (string | number)[][] =>
  definitionsOf(path, lines.join('\n')).map((one) => [one.name, ...one.lines, ...(one.test ? ['test'] : [])]);

test('the finder reads TypeScript by its braces: functions, a nested arrow, a class with a method, a route handler, and no helper of 3 lines', () => {
  assert.deepEqual(found('src/cart.ts', [
    'import { x } from "./x";',
    'export function total(items: number[]): number {',
    '  const add = (a: number, b: number): number => {',
    '    const sum = a + b;',
    '    return sum;',
    '  };',
    '  return items.reduce(add, 0);',
    '}',
    'const twice = (n: number) => n * 2;',
    'function three(a: number) {',
    '  return a;',
    '}',
    'export class Cart {',
    '  private items: number[] = [];',
    '  add(item: number): { count: number } {',
    '    if (item > 9) {',
    '      console.log("a brace { in a string", /}/.test("x"));',
    '    }',
    '    return { count: this.items.push(item) };',
    '  }',
    '}',
    "app.get('/cart', (req, res) => {",
    '  const cart = new Cart();',
    '  res.send(`${cart.add(1).count} {`);',
    '});',
  ]), [['total', 2, 8], ['add', 3, 6], ['Cart', 13, 21], ['add', 15, 20], ['get /cart', 22, 25]]);
  assert.deepEqual(found('src/cart.test.ts', [
    "test('adds an item', () => {",
    '  const cart = new Cart();',
    '  cart.add(1);',
    '  assert.equal(cart.size, 1);',
    '});',
  ]), [['adds an item', 1, 5, 'test']]);
});

test('the finder reads Go, Rust, Java and C by their braces: methods, a Go test, an impl with a lifetime, a body on its own line, and no declaration', () => {
  assert.deepEqual(found('server.go', [
    'func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {',
    '\tname := r.URL.Query().Get("name")',
    '\tfmt.Fprintf(w, "hello %s {", name)',
    '\tlog.Println(name)',
    '}',
    'func short() int {',
    '\treturn 1',
    '}',
  ]), [['Handle', 1, 5]]);
  assert.deepEqual(found('server_test.go', ['func TestHandle(t *testing.T) {', '\ts := New()', '\ts.Handle(nil, nil)', '}']), [['TestHandle', 1, 4, 'test']]);
  assert.deepEqual(found('src/lib.rs', [
    'impl Point {',
    "    pub fn shifted<'a>(&'a self, by: i32) -> Point {",
    '        let x = self.x + by;',
    '        Point { x }',
    '    }',
    '}',
  ]), [['Point', 1, 6], ['shifted', 2, 5]]);
  assert.deepEqual(found('Shop.java', [
    'public class Shop',
    '{',
    '    public int total(List<Integer> prices)',
    '    {',
    '        int sum = 0;',
    '        for (int price : prices) { sum += price; }',
    '        return sum;',
    '    }',
    '    abstract void open();',
    '}',
  ]), [['Shop', 1, 10], ['total', 3, 8]]);
  assert.deepEqual(found('calc.c', ['static int square(int x) {', '    int y = x * x;', '    /* a brace { in a comment */', '    return y;', '}', 'int cube(int x);']), [['square', 1, 5]]);
});

test('the finder reads Python by its indentation: a class, methods, a header on several lines, a nested function, a docstring, a test, and no helper of 2 lines', () => {
  assert.deepEqual(found('shop.py', [
    'import os',
    'class Shop:',
    '    def __init__(self, items):',
    '        self.items = items',
    '        self.open = True',
    '        self.name = "shop:"',
    '',
    '    def total(',
    '        self,',
    '        tax,',
    '    ):',
    '        def with_tax(price):',
    '            text = """',
    'def not_a_function():',
    '"""',
    '            return price * tax',
    '',
    '        return sum(with_tax(p) for p in self.items)',
    'def tiny():',
    '    return 1',
    'def test_total():',
    '    shop = Shop([1, 2])',
    '    assert shop.total(1) == 3',
    '    assert shop.open',
  ]), [['Shop', 2, 18], ['__init__', 3, 6], ['total', 8, 18], ['with_tax', 12, 16], ['test_total', 21, 24, 'test']]);
});

test('the finder reads Ruby by "end" at the same indentation: a class, methods, a test block, and no method of 3 lines', () => {
  assert.deepEqual(found('shop.rb', [
    'class Shop',
    '  def initialize(items)',
    '    @items = items',
    '    @open = true',
    '  end',
    '  def total',
    '    @items.sum',
    '  end',
    '  def self.build(list)',
    '    shop = new(list)',
    '    shop.open!',
    '    shop',
    '  end',
    'end',
  ]), [['Shop', 1, 14], ['initialize', 2, 5], ['build', 9, 13]]);
  assert.deepEqual(found('shop_test.rb', ['it "sums the items" do', '  shop = Shop.new([1, 2])', '  expect(shop.total).to eq(3)', 'end']), [['sums the items', 1, 4, 'test']]);
});

test('the finder gives nothing for a language that it does not know', () => {
  assert.deepEqual(found('lib/shop.ex', ['defmodule Shop do', '  def total(items) do', '    Enum.sum(items)', '  end', 'end']), []);
  assert.deepEqual(found('README.md', ['function total() {', '  return 1;', '  // more', '}']), []);
});
