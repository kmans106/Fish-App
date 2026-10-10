// Thin wrappers around Capacitor plugins, with harmless fallbacks when running in a plain browser
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';

const native = Capacitor.isNativePlatform();
let lastTap = 0;

export const haptics = {
	// small tick for every catch, throttled so a feeding frenzy doesn't turn into a buzz
	tap() {

		const now = performance.now();
		if ( ! native || now - lastTap < 70 ) return;
		lastTap = now;
		Haptics.impact( { style: ImpactStyle.Light } ).catch( () => {} );

	},
	thump() {

		if ( native ) Haptics.impact( { style: ImpactStyle.Heavy } ).catch( () => {} );

	},
	done() {

		if ( native ) Haptics.notification( { type: NotificationType.Success } ).catch( () => {} );

	},
};

export async function loadNumber( key, fallback = 0 ) {

	try {

		const { value } = await Preferences.get( { key } );
		const n = Number( value );
		return value !== null && Number.isFinite( n ) ? n : fallback;

	} catch {

		return fallback;

	}

}

export function saveNumber( key, n ) {

	Preferences.set( { key, value: String( n ) } ).catch( () => {} );

}
