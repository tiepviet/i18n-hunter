import React from 'react';
import { useTranslation } from 'react-i18next'

export const Header = () => {
  const { t } = useTranslation()
  return (
    <header className="main-header">
      <nav>
        <ul>
          <li>{t('common.msg.home')}</li>
          <li>{t('common.msg.our_services')}</li>
          <li>{t('common.msg.contact_us')}</li>
        </ul>
      </nav>
      
      <div class="user-menu">
        <button label={t('common.lbl.logout')}>{t('common.btn.exit_system')}</button>
      </div>

      <div class="alert shadow">
        <strong>{t('common.lbl.warning')}</strong> {t('common.msg.you_are_currently_us')}
      </div>
    </header>
  );
};
