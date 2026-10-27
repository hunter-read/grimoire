import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import './index.css'
import { languageReady } from './i18n'
import { initTheme } from './utils/theme'
import { logRenderError } from './utils/renderErrors'

// Before the first render, so the app never paints in the wrong theme.
initTheme()

// Likewise the language: a locale other than the bundled en-US is fetched first,
// so the app never paints in English and then switches. A failed fetch still
// renders, in English.
languageReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!, {
    onCaughtError: logRenderError('caught'),
    onUncaughtError: logRenderError('uncaught'),
  }).render(
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  )
})
