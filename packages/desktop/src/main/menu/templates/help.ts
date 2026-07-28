import { shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/help'
import { t } from '../../i18n'
import {
  DISCUSSIONS_URL,
  DOCUMENTATION_URLS,
  ISSUES_URL,
  LICENSE_URL,
  RELEASES_URL,
  REPOSITORY_URL
} from '@shared/brand'

export default function(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.help.markdownReference'),
      click() {
        shell.openExternal(DOCUMENTATION_URLS.markdownSyntax)
      }
    },
    {
      label: t('menu.help.changelog'),
      click() {
        shell.openExternal(RELEASES_URL)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.askQuestion'),
      click() {
        shell.openExternal(DISCUSSIONS_URL)
      }
    },
    {
      label: t('menu.help.reportBug'),
      click() {
        shell.openExternal(ISSUES_URL)
      }
    },
    {
      label: t('menu.help.viewSource'),
      click() {
        shell.openExternal(REPOSITORY_URL)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.license'),
      click() {
        shell.openExternal(LICENSE_URL)
      }
    }
  ]

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help.help'),
    role: 'help',
    submenu
  }

  if (process.platform !== 'darwin') {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.about'),
        click(_menuItem, browserWindow) {
          actions.showAboutDialog(browserWindow as BrowserWindow | undefined)
        }
      }
    )
  }
  return helpMenu
}
