import assert from 'node:assert/strict'
import test from 'node:test'
import { bindFoundationRouteContext, foundationRouteHref } from '../../site/client/foundation-route-context.js'

test('canvas destinations retain an explicit route only for its own stations', () => {
    const current = 'https://example.test/foundations/matrix.html?route=linear'
    const paths = new Set(['/foundations/vector-space.html'])
    const href = '/foundations/vector-space.html#definition'
    assert.equal(
        foundationRouteHref(href, current, 'linear', paths),
        '/foundations/vector-space.html?route=linear#definition'
    )
    assert.equal(foundationRouteHref(href, current, '', paths), href)
    for (const target of [
        '/foundations/other.html',
        'https://elsewhere.test/foundations/vector-space.html',
        '/foundations/vector-space.html?route=other',
        '#definition'
    ])
        assert.equal(foundationRouteHref(target, current, 'linear', paths), target)
})

class ElementStub {
    hidden = false
    open = false
    dataset: Record<string, string> = {}
    attributes = new Map<string, string>()
    getAttribute(name: string) {
        return this.attributes.get(name) ?? null
    }
    setAttribute(name: string, value: string) {
        this.attributes.set(name, value)
    }
    removeAttribute(name: string) {
        this.attributes.delete(name)
    }
}

function fixture(search = '') {
    const panels = ['route-a', 'route-b'].map((id) => {
        const panel = new ElementStub()
        panel.dataset = {
            foundationRoutePanel: id,
            foundationRoutePaths: JSON.stringify(['/foundations/focus.html', `/foundations/${id}.html`])
        }
        return panel
    })
    const choices = panels.map((panel) => {
        const choice = new ElementStub()
        choice.dataset.foundationRouteChoice = panel.dataset.foundationRoutePanel
        return choice
    })
    const controls = new Map(['choices', 'prompt', 'invalid', 'clear'].map((key) => [key, new ElementStub()]))
    const navigation = Object.assign(new ElementStub(), {
        querySelector: (selector: string) =>
            controls.get(selector.replace('[data-foundation-route-', '').replace(']', '')),
        querySelectorAll: (selector: string) => (selector.endsWith('-panel]') ? panels : choices),
        contains: (element: ElementStub) => choices.includes(element)
    })
    const hrefs = [
        '/foundations/route-a.html#example',
        '/foundations/route-b.html',
        '/foundations/outside.html',
        'https://elsewhere.test/foundations/route-a.html',
        '#example',
        '/foundations/route-a.html?route=explicit-route',
        '/foundations/route-a.html?view=full#example'
    ]
    const links = hrefs.map((href) => {
        const link = new ElementStub()
        link.setAttribute('href', href)
        return link
    })
    const listeners = new Map<string, () => void>()
    const location = { href: `https://example.test/foundations/focus.html${search}`, origin: 'https://example.test' }
    const root = { querySelector: () => navigation, querySelectorAll: () => [...links, ...choices] }
    const browser = {
        location,
        addEventListener: (type: string, callback: () => void) => listeners.set(type, callback)
    }
    bindFoundationRouteContext(root as unknown as ParentNode, browser as unknown as Window)
    return {
        panels,
        choices,
        controls,
        navigation,
        links,
        hrefs,
        navigate(search: string, event = 'popstate') {
            location.href = `https://example.test/foundations/focus.html${search}`
            listeners.get(event)!()
        }
    }
}

test('direct arrivals retain every route without assuming an active one', () => {
    const f = fixture()
    assert.equal(f.navigation.dataset.routeContext, 'unselected')
    assert.ok(f.panels.every((panel) => !panel.hidden && !panel.open))
    assert.ok(f.controls.get('choices')!.hidden)
    assert.ok(!f.controls.get('prompt')!.hidden)
    assert.ok(f.controls.get('invalid')!.hidden)
    assert.ok(f.controls.get('clear')!.hidden)
    assert.deepEqual(
        f.links.map((link) => link.getAttribute('href')),
        f.hrefs
    )
})

test('explicit context survives reload, pageshow and back/forward route switches', () => {
    const f = fixture('?route=route-a')
    assert.equal(f.navigation.dataset.routeContext, 'selected')
    assert.ok(!f.panels[0].hidden && f.panels[0].open && f.panels[1].hidden)
    assert.equal(f.choices[0].getAttribute('aria-current'), 'true')
    assert.ok(!f.controls.get('choices')!.hidden)
    assert.equal(f.links[0].getAttribute('href'), '/foundations/route-a.html?route=route-a#example')
    assert.deepEqual(
        f.links.slice(1, 6).map((link) => link.getAttribute('href')),
        f.hrefs.slice(1, 6)
    )
    assert.equal(f.links[6].getAttribute('href'), '/foundations/route-a.html?view=full&route=route-a#example')
    f.navigate('?route=route-a', 'pageshow')
    assert.equal(f.links[0].getAttribute('href'), '/foundations/route-a.html?route=route-a#example')
    f.navigate('?route=route-b')
    assert.ok(f.panels[0].hidden && !f.panels[1].hidden && f.panels[1].open)
    assert.equal(f.choices[0].getAttribute('aria-current'), null)
    assert.equal(f.choices[1].getAttribute('aria-current'), 'true')
    assert.equal(f.links[0].getAttribute('href'), f.hrefs[0])
    assert.equal(f.links[1].getAttribute('href'), '/foundations/route-b.html?route=route-b')
    f.navigate('?route=route-a')
    assert.equal(f.links[0].getAttribute('href'), '/foundations/route-a.html?route=route-a#example')
    const reloaded = fixture('?route=route-a')
    assert.deepEqual(
        reloaded.panels.map((panel) => panel.hidden),
        f.panels.map((panel) => panel.hidden)
    )
    f.navigate('')
    assert.ok(f.panels.every((panel) => !panel.hidden))
    assert.deepEqual(
        f.links.map((link) => link.getAttribute('href')),
        f.hrefs
    )
})

test('invalid, empty and injected route values expose choices without using the value as HTML or a selector', () => {
    for (const value of ['unknown', '', encodeURIComponent('route-a"]<script>alert(1)</script>')]) {
        const f = fixture(`?route=${value}`)
        assert.equal(f.navigation.dataset.routeContext, 'invalid')
        assert.ok(f.panels.every((panel) => !panel.hidden))
        assert.ok(!f.controls.get('invalid')!.hidden)
        assert.ok(f.controls.get('prompt')!.hidden)
        assert.ok(f.choices.every((choice) => choice.getAttribute('aria-current') === null))
        assert.deepEqual(
            f.links.map((link) => link.getAttribute('href')),
            f.hrefs
        )
    }
})
