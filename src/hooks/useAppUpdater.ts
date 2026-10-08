import { createElement, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'react-toastify';
import i18n from '../i18n';

const CHECK_DELAY_MS = 5000;

/**
 * Release builds look for a newer release (latest.json on the GitHub releases) once, shortly
 * after launch, and offer to install it. The plugin verifies the minisign signature first.
 */
export function useAppUpdater() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;

        const install = async (closeToast?: () => void) => {
          closeToast?.();
          const progress = toast.info(i18n.t('updater.installing', { defaultValue: 'Downloading the update…' }), {
            autoClose: false,
          });
          try {
            await update.downloadAndInstall();
            await relaunch();
          } catch (err) {
            toast.dismiss(progress);
            toast.error(`${i18n.t('updater.failed', { defaultValue: 'Update failed' })}: ${err}`);
          }
        };

        toast.info(
          ({ closeToast }) =>
            createElement(
              'div',
              { className: 'flex flex-col gap-2' },
              createElement(
                'span',
                null,
                i18n.t('updater.available', {
                  defaultValue: 'Rayfine {{version}} is available.',
                  version: update.version,
                }),
              ),
              createElement(
                'button',
                {
                  type: 'button',
                  className: 'self-start rounded bg-accent px-2 py-1 text-xs text-button-text',
                  onClick: () => void install(closeToast),
                },
                i18n.t('updater.install', { defaultValue: 'Update and restart' }),
              ),
            ),
          { autoClose: false, closeOnClick: false },
        );
      } catch (err) {
        console.warn('Update check failed:', err);
      }
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
}
