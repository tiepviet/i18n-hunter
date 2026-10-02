import { useTranslation } from 'react-i18next'

export const App = () => {
  const { t } = useTranslation()

  return (
    <main className="user-card">
      <h1>User Information</h1>
      <p>Welcome to our system. Please manage your profile below.</p>
      <button type="button" onClick={() => console.info(t('feedback.saved'))}>
        Save Changes
      </button>
      <button type="button">Cancel Operation</button>
    </main>
  )
}
