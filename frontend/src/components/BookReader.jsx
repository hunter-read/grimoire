import { useParams } from 'react-router-dom'
import ReaderView from '../views/ReaderView'

/**
 * Wrapper that forces ReaderView to fully remount when bookId changes.
 * Without this, React keeps the same component instance across book navigations,
 * leaving currentPage/book/totalPages stale and rendering the wrong content.
 */
export default function BookReader() {
  const { bookId } = useParams()
  return <ReaderView key={bookId} />
}
