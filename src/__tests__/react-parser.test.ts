import { describe, it, expect } from 'vitest'
import { parseReactComponent } from '../react-parser.js'

describe('react-parser', () => {
  it('extracts strings from functional component JSX', () => {
    const code = `const Header = () => <div title="Home Page">Hello React</div>`
    const results = parseReactComponent(code, 'App.tsx')
    
    const values = results.map(r => r.value)
    expect(values).toContain('Hello React')
    expect(values).toContain('Home Page')
    
    const hello = results.find(r => r.value === 'Hello React')
    expect(hello?.context).toBe('tag:div')
  })

  it('skips technical attributes in JSX', () => {
    const code = `<button className="primary" id="btn-123" type="submit">Submit Now</button>`
    const results = parseReactComponent(code, 'App.tsx')
    expect(results).toHaveLength(1)
    expect(results[0].value).toBe('Submit Now')
    expect(results[0].context).toBe('tag:button')
  })

  it('extracts strings from component logic', () => {
    const code = `
    const Page = () => {
        const [msg, setMsg] = useState("Status Loaded")
        useEffect(() => {
            alert("App Ready")
        }, [])
        return <div>{msg}</div>
    }`
    const results = parseReactComponent(code, 'Page.tsx')
    const values = results.map(r => r.value)
    expect(values).toContain('Status Loaded')
    expect(values).toContain('App Ready')
  })

  it('detects notifications in React scripts', () => {
    const code = `toast.error("Failed to load")`
    const results = parseReactComponent(code, 'Page.tsx')
    expect(results[0].isNotification).toBe(true)
    expect(results[0].notificationType).toBe('error')
  })
})
