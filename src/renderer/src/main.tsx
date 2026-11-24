import React from 'react'
import ReactDOM from 'react-dom/client'
import './assets/main.css'
import App from './App'
import { TeleprompterHud } from './components/Hud/TeleprompterHud'

const isHudView =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('view') === 'hud' ||
    window.location.hash.toLowerCase().includes('hud'))

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isHudView ? <TeleprompterHud /> : <App />}
  </React.StrictMode>
)
