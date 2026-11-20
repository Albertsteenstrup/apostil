#!/usr/bin/env node
// The Apostil helper: an MCP server over standard input and output (JSON-RPC 2.0, one message per line).

import { createInterface } from 'node:readline';
import { diagramTitles, reviewContext, showDiagram } from '../shared/context';
import { repoId } from '../shared/git';
import { findInMap, mapOverview, NO_MAP_WORDS } from '../shared/map-read';
import { Store } from '../shared/store';
import { thisInstall } from '../store/setup';

const folderInput = { type: 'string', description: 'The folder (worktree) that you work in.' };

const tools = [
  {
    name: 'review_context',
    description: 'Gives the review remarks of the owner for the change in your folder: the remarks that you have not read yet, what the owner has open and selected, and the open points. '
      + 'Call it when the owner says something like "address my remarks" or "look at what I selected".',
    inputSchema: {
      type: 'object',
      properties: { folder: folderInput, mark_sent: { type: 'boolean', description: 'Set to true to mark the remarks as read, so the next call does not return them again.' } },
      required: ['folder'],
    },
  },
  {
    name: 'diagram_titles',
    description: 'Lists the diagrams of this repo with an id, a title and the file each one is about, but without the diagram code. Call it before you change code, to find the diagrams that the change touches.',
    inputSchema: {
      type: 'object',
      properties: { folder: folderInput, path: { type: 'string', description: 'Only diagrams of files under this path, for example "src/".' } },
      required: ['folder'],
    },
  },
  {
    name: 'show_diagram',
    description: 'Gives one diagram in full, with its Mermaid code and the code lines it is about. Call it with an id from diagram_titles when you need the detail.',
    inputSchema: {
      type: 'object',
      properties: { folder: folderInput, id: { type: 'string', description: 'The id of the diagram.' } },
      required: ['folder', 'id'],
    },
  },
  {
    name: 'map_overview',
    description: 'Gives the overview of the map of this repo as plain text: the top diagram with the folders and files of each area, the other diagrams, the counts and the next commands. '
      + 'Call it first, before you search or read files to find or understand code.',
    inputSchema: { type: 'object', properties: { folder: folderInput }, required: ['folder'] },
  },
  {
    name: 'find_in_map',
    description: 'Finds the notes, processes and diagrams of the map of this repo that match some words, best first, as plain text: each note with its file and its lines now. '
      + 'Call it with the words of your task before you search the code.',
    inputSchema: {
      type: 'object',
      properties: { folder: folderInput, words: { type: 'string', description: 'The words to find, for example the words of an issue.' }, limit: { type: 'number', description: 'The most notes to give; 20 by default.' } },
      required: ['folder', 'words'],
    },
  },
  {
    name: 'answer_remark',
    description: 'Records your answer to one review remark of the owner, after you acted on it or decided that you cannot. Apostil shows the answer next to the remark and marks the remark as done. '
      + 'Call it once for each remark that review_context gave you. Write one to three sentences: what you did, or why you did not act. Your reply in the chat stays as it is.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: folderInput,
        id: { type: 'number', description: 'The id of the remark, from review_context.' },
        text: { type: 'string', description: 'Your answer, in one to three sentences.' },
      },
      required: ['folder', 'id', 'text'],
    },
  },
];

type Args = Record<string, unknown>;

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError });

/** Runs one tool and returns its MCP result. A failure becomes one plain sentence. */
function callTool(name: string, args: Args) {
  if (!tools.some((tool) => tool.name === name)) return text(`There is no tool named ${name}.`, true);
  if (typeof args.folder !== 'string' || !args.folder) return text('The input "folder" is missing.', true);
  const store = new Store();
  try {
    if (name === 'review_context') return text(reviewContext(store, args.folder, args.mark_sent === true));
    if (name === 'diagram_titles') return text(diagramTitles(store, args.folder, typeof args.path === 'string' ? args.path : ''));
    if (name === 'map_overview' || name === 'find_in_map') { // the same plain text as apostil overview and apostil find
      const stored = store.getMap(repoId(args.folder));
      if (!stored) return text(NO_MAP_WORDS, true);
      if (name === 'map_overview') return text(mapOverview(stored));
      if (typeof args.words !== 'string' || !args.words.trim()) return text('The input "words" is missing.', true);
      return text(findInMap(args.folder, stored, args.words, typeof args.limit === 'number' && args.limit >= 1 ? Math.floor(args.limit) : 20));
    }
    if (name === 'answer_remark') {
      if (typeof args.id !== 'number' || typeof args.text !== 'string' || !args.text) return text('The inputs "id" and "text" are needed.', true);
      const remark = store.answerRemark(args.id, args.text);
      return remark ? text(remark) : text(`There is no remark with the id ${args.id}.`, true);
    }
    if (typeof args.id !== 'string') return text('The input "id" is missing.', true);
    const shown = showDiagram(store, args.folder, args.id);
    return shown ? text(shown) : text(`There is no diagram with the id ${args.id}.`, true);
  } catch (error) {
    return text(`The tool failed: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    store.close();
  }
}

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** The result for one request, or an error code and message. */
function answer(method: string, params: Args): { result: unknown } | { error: { code: number; message: string } } {
  if (method === 'initialize') {
    const protocolVersion = versions.includes(params.protocolVersion as string) ? params.protocolVersion : versions[0];
    return { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'apostil', version: thisInstall().version } } };
  }
  if (method === 'ping') return { result: {} };
  if (method === 'tools/list') return { result: { tools } };
  if (method === 'tools/call') return { result: callTool(String(params.name), (params.arguments ?? {}) as Args) };
  return { error: { code: -32601, message: `Method not found: ${method}` } };
}

const send = (message: object): void => { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); };

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let message: { id?: string | number; method?: string; params?: Args };
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (message.id === undefined || typeof message.method !== 'string') return; // a notification or a reply: nothing to answer
  send({ id: message.id, ...answer(message.method, message.params ?? {}) });
});
