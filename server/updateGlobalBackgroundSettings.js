const { updateGlobalBackgroundSetting } = require('./src/services/background_settings.service');

const updateGlobalBackgroundSettings = async (setting) => {
  if(setting.accessToken) {
    updateGlobalBackgroundSetting(setting.id, {
      bgColor: setting.bgColor,
      onoff: setting.onoff,
      accessToken: setting.accessToken
    });
  } else {
    updateGlobalBackgroundSetting(setting.id, {
      bgColor: setting.bgColor,
      onoff: setting.onoff
    });
  }
  return;
};
  
module.exports = updateGlobalBackgroundSettings;