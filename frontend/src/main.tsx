import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { IconContext } from 'react-icons'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import './index.css'
import { languageReady } from './i18n'
import { initTheme } from './utils/theme'
import { logRenderError } from './utils/renderErrors'

// Before the first render, so the app never paints in the wrong theme.
initTheme()

// Icons are decoration beside a text label or inside a labelled button, so
// screen readers skip them. An icon that is the only thing carrying meaning
// passes its own aria-hidden={false} plus a role and label, which win over this.
const ICON_DEFAULTS: IconContext = { attr: { 'aria-hidden': true, focusable: 'false' } }

// Likewise the language: a locale other than the bundled en-US is fetched first,
// so the app never paints in English and then switches. A failed fetch still
// renders, in English.
// i18next resolves init even when the locale fails to load, so this never rejects.
void languageReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!, {
    onCaughtError: logRenderError('caught'),
    onUncaughtError: logRenderError('uncaught'),
  }).render(
    <BrowserRouter>
      <IconContext.Provider value={ICON_DEFAULTS}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </IconContext.Provider>
    </BrowserRouter>
  )
})
