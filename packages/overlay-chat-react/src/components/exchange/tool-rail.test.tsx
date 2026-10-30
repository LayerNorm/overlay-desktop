import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolLineLogo, ToolLogoColumn, TraceMark } from './tool-rail'

test('tool row compatibility slots render no markup while running or idle', () => {
  const slots = [
    <TraceMark key="trace-idle" />,
    <TraceMark key="trace-running" running />,
    <ToolLineLogo key="tool-logo-idle" />,
    <ToolLineLogo key="tool-logo-running" running />,
    <ToolLogoColumn key="column-idle" connectTop connectBottom />,
    <ToolLogoColumn key="column-running" connectTop connectBottom running />,
  ]

  for (const slot of slots) assert.equal(renderToStaticMarkup(slot), '')
})
