import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import glsl from 'vite-plugin-glsl'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
   plugins: [react(), glsl(), VitePWA({
       // prompt + manual registration (virtual:pwa-register in
       // PwaUpdateToast.jsx): updates surface as a Refresh toast instead of
       // silently serving stale builds. injectRegister:false avoids double
       // registration with the manual one.
       registerType: 'prompt',
       injectRegister: false,
       includeAssets: [ 'Game_icon.jpg'],
       manifest: {
         name: 'Mario Kart 3.js',
         short_name: 'MK3.JS',
         start_url: '/',
         display: 'standalone',
         background_color: '#FF0000',
         theme_color: '#FF0000',
         icons: [
           {
             src: 'Game_icon.jpg',
             sizes: '456x438',
             type: 'image/jpeg'
           },
         ],
       },
       workbox: {
         maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
         // Activate the new SW immediately in the background; the PAGE only
         // reloads when the user taps Refresh in the toast (never mid-race
         // by surprise).
         skipWaiting: true,
         clientsClaim: true,
       },
     })],
})
