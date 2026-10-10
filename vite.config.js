import { defineConfig } from 'vite';

export default defineConfig( {
	// relative asset paths so the build loads from the iOS app bundle (capacitor://localhost)
	base: './',
	build: {
		target: 'es2022',
		chunkSizeWarningLimit: 2000,
	},
} );
