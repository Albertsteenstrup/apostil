// A small way to draw a component in the tests, with a fake server for the calls of the page.
// It is not a framework: it renders into a div of the test page and waits until the calls are answered.

import { act } from 'react';
import { createRoot } from 'react-dom/client';

type Reply = unknown | { status: number; body: unknown };

/** A server that answers each "METHOD /path" with what the test gave, and keeps what the page sent. */
export function fakeServer(replies: Record<string, Reply>) {
  const sent = new Map<string, unknown[]>();
  const server = {
    answer(key: string, reply: Reply) {
      replies[key] = reply;
    },
    sent(key: string): unknown[] {
      return sent.get(key) ?? [];
    },
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      const key = `${init.method ?? 'GET'} ${path}`;
      if (init.body) sent.set(key, [...server.sent(key), JSON.parse(String(init.body))]);
      if (!(key in replies)) return new Response(JSON.stringify({ message: `No reply for ${key} in this test.` }), { status: 500 });
      const reply = replies[key] as { status?: number; body?: unknown };
      const status = typeof reply === 'object' && reply !== null && 'status' in reply ? reply.status ?? 200 : 200;
      const body = status === 200 && !(typeof reply === 'object' && reply !== null && 'body' in reply) ? reply : reply.body;
      return new Response(JSON.stringify(body), { status });
    },
  };
  return server;
}

/** Draws the element with the fake server in place of fetch, and waits for the first calls. */
export async function renderPage(element: JSX.Element, server: ReturnType<typeof fakeServer>): Promise<HTMLElement> {
  globalThis.fetch = server.fetch as typeof fetch;
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(element);
  });
  await settle();
  return host;
}

/** Waits until the answers of the fake server reached the page. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await act(async () => new Promise((done) => setTimeout(done, 0)));
}

export function textOf(page: HTMLElement, selector: string): string[] {
  return [...page.querySelectorAll(selector)].map((element) => element.textContent?.trim() ?? '');
}

export async function click(page: HTMLElement, selector: string): Promise<void> {
  const element = page.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Nothing to click at ${selector}`);
  await act(async () => element.click());
  await settle();
}

export async function typeInto(page: HTMLElement, selector: string, text: string): Promise<void> {
  const field = page.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`No field at ${selector}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
