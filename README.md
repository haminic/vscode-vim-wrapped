# Vim Wrapped

## ▸ About 📖

This is a Visual Studio Code extension adding proper line-wrapped motions. Note that this is hacky, and this hack have already been addressed in (VS Code Vim)[https://marketplace.visualstudio.com/items?itemName=vscodevim.vim]'s GitHub discussion page.

Note that in addition to just implementing the hack, because I'm Thai, I also made it so that it takes into account the zero-width diacritics when calculating the visual columns to go to.

## ▸ How to Use ❓

Simply bind the command `vimWrapped.cursorDown` to `gj`, and `vimWrapped.cursorUp` to `gk` in your favorite Vim Emulator.