import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import glsl from 'vite-plugin-glsl'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), glsl(), VitePWA({
       registerType: 'autoUpdate',
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
          
         ]
       }
     })],
})
