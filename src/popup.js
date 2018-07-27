import 'babel-polyfill';
import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import browser from 'webextension-polyfill';
import { hasIabConsent, IABConsent } from './iab-framework';
import { sendTelemetry } from './telemetry';

class Popup extends Component {

  componentWillMount() {
    browser.tabs.query({active: true, currentWindow: true}).then(async (tab) => {
      const site = new URL(tab[0].url).host;
      this.setState({ tab: tab[0], site });
      const iabConsent = await hasIabConsent(tab[0]);
      if (iabConsent) {
        this.setState({ kind: 'iab', consent: iabConsent });
        sendTelemetry({
          type: 'iab',
          site,
          writeable: iabConsent.writeable,
        }, 'metrics.consentric.popupOpened');
        return;
      }
    });
  }

  render() {
    if (this.state && this.state.tab) {
      const { tab, site, kind, consent } = this.state;
      let contents = null;
      if (kind === 'iab') {
        contents = <IABConsent tab={tab} site={site} consent={consent} />;
      } else {
        contents = <p>Waiting for consent data...</p>;
      }
      return (
        <div className="container" >
          <h4>Consent given for {site}</h4>
          {contents}
        </div>
      )

    }
    return (
      <div className="container" >
        <h4>Loading...</h4>
      </div>
    );
  }
}

ReactDOM.render(
  <Popup/>,
  document.getElementById('root')
);
