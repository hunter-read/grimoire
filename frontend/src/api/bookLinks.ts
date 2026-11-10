/**
 * A book shown on more shelves than its own (issue #446): the systems it is
 * linked onto besides the one its folder gives it. Each call answers with the
 * book's links as they now stand.
 */
import { client } from './client'

const book = (bookId: string) => ({ book_id: bookId })

export const bookLinks = {
  list: (bookId: string) => client.get('/books/{book_id}/systems', { path: book(bookId) }),
  add: (bookId: string, systemId: string) =>
    client.post('/books/{book_id}/systems', { path: book(bookId), body: { system_id: systemId } }),
  remove: (bookId: string, systemId: string) =>
    client.delete('/books/{book_id}/systems/{system_id}', {
      path: { ...book(bookId), system_id: systemId },
    }),
}
