import Spinner from './Spinner'

/** What a route shows while its view's chunk is still downloading. */
export default function RouteFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 16px' }}>
      <Spinner size={28} />
    </div>
  )
}
