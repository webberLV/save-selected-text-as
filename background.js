'use strict';

const MENU_ID = 'save-selected-text-as';
const DEFAULT_FILENAME = 'selected-text.txt...';
const ICON_FLASH_MS = 1500;
const NO_SELECTION_COLOR = '#ff5a5f';

const DEFAULT_ICON = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png'
};

let restoreIconTimer = null;

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Save text as',
      contexts: ['selection']
    });
  });
}

function restoreDefaultIcon() {
  chrome.action.setIcon({ path: DEFAULT_ICON });
  chrome.action.setBadgeText({ text: '' });
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');

  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function isBluePixel(r, g, b, a) {
  return a > 0 && b > r + 40 && b > g + 20;
}

async function createRecoloredIconData(color) {
  const replacement = hexToRgb(color);
  const imageDataBySize = {};

  for (const size of [16, 32, 48, 128]) {
    const response = await fetch(chrome.runtime.getURL(DEFAULT_ICON[size]));
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(bitmap, 0, 0, size, size);

    const imageData = ctx.getImageData(0, 0, size, size);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];

      if (isBluePixel(r, g, b, a)) {
        pixels[i] = replacement.r;
        pixels[i + 1] = replacement.g;
        pixels[i + 2] = replacement.b;
      }
    }

    imageDataBySize[size] = imageData;
  }

  return imageDataBySize;
}

async function flashIconColor(color = NO_SELECTION_COLOR) {
  try {
    const imageData = await createRecoloredIconData(color);

    chrome.action.setIcon({ imageData });

    if (restoreIconTimer) {
      clearTimeout(restoreIconTimer);
    }

    restoreIconTimer = setTimeout(() => {
      restoreDefaultIcon();
      restoreIconTimer = null;
    }, ICON_FLASH_MS);
  } catch (error) {
    chrome.action.setBadgeText({ text: '!' });

    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, ICON_FLASH_MS);
  }
}

function saveTextAsFile(selectedText) {
  if (typeof selectedText !== 'string' || selectedText.length === 0) {
    flashIconColor();
    return;
  }

  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(selectedText)}`;

  chrome.downloads.download({
    url: dataUrl,
    filename: DEFAULT_FILENAME,
    saveAs: true,
    conflictAction: 'uniquify'
  });
}

function getSelectedTextFromPage() {
  const activeElement = document.activeElement;

  if (activeElement) {
    const tagName = activeElement.tagName;
    const isTextArea = tagName === 'TEXTAREA';
    const isTextInput = tagName === 'INPUT' && typeof activeElement.selectionStart === 'number';

    if (isTextArea || isTextInput) {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;

      if (typeof start === 'number' && typeof end === 'number' && start !== end) {
        return activeElement.value.substring(start, end);
      }
    }
  }

  const selection = window.getSelection();
  return selection ? selection.toString() : '';
}

async function saveSelectionFromActiveTab(tab) {
  if (!tab || typeof tab.id !== 'number') {
    flashIconColor();
    return;
  }

  try {
    const frameResults = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        allFrames: true
      },
      func: getSelectedTextFromPage
    });

    const selectedText = frameResults
      .map((result) => result && result.result)
      .find((text) => typeof text === 'string' && text.length > 0);

    saveTextAsFile(selectedText || '');
  } catch (error) {
    flashIconColor();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  restoreDefaultIcon();
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  restoreDefaultIcon();
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) {
    saveTextAsFile(info.selectionText || '');
  }
});

chrome.action.onClicked.addListener((tab) => {
  saveSelectionFromActiveTab(tab);
});
