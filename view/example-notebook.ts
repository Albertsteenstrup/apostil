// A made-up change to notebooks, as the page shows it: for the browser check, which puts it into the page of the example.
// It makes the made-up notebook repo in a temporary folder, builds the page data and every answer the page can ask, and removes the folder.

import { makeNotebookRepo, notebookChangeFile } from '../shared/test-repo';
import { allQuestions, answer, examplePage, type PageData } from './page-data';

export function notebookExample(): { page: PageData; answers: Record<string, unknown> } {
  const repo = makeNotebookRepo();
  try {
    const page = examplePage(repo.folder, repo.base, notebookChangeFile(), []);
    return { page, answers: Object.fromEntries(allQuestions(page).map((question) => [question, answer(page, question)])) };
  } finally {
    repo.remove();
  }
}
