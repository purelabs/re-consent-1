import React, { Component } from 'react';
import { ConsentString } from 'consent-string';
import browser from 'webextension-polyfill';
import moment from 'moment';
import createPageChannel from './page-actions';
import { EUConsentCookie, LocalStorageConsent, OilCookie } from './iab-vendors';
import { sendTelemetry, sendAnonymousTelemetry } from './telemetry';

export const PURPOSES = {
  1: 'Information storage and access',
  2: 'Personalisation',
  3: 'Ad selection, delivery, reporting',
  4: 'Content selection, delivery, reporting',
  5: 'Measurement',
}

async function addVendorList(page, consent) {
  let vendorList = await page.getVendorList().catch(() => null);
  if (!vendorList || !vendorList.vendorListVersion) {
    vendorList = await fetch('https://vendorlist.consensu.org/vendorlist.json').then(r => r.json());
  }
  consent.setGlobalVendorList(vendorList);
}

export async function setConsentCookie(tab, consent, newConsent) {
  const page = createPageChannel(tab.id);
  await addVendorList(page, newConsent);
  await Promise.all(consent.storage.map((sto) => sto.update(newConsent)));
  consent.metadata = newConsent.getConsentString();
  return consent;
}

export async function hasIabConsent(tab) {
  const page = createPageChannel(tab.id);
  const site = new URL(tab.url).host;
  const hasCmp = await page.hasCmp()
  if (hasCmp) {
    const consent = await page.getConsentData();
    if (!consent) {
      sendTelemetry({}, 'metrics.consentric.iab.cmpNoData');
      return false;
    }
    const { purposeConsents, vendorConsents, metadata } = await page.getVendorConsents();
    consent.purposeConsents = purposeConsents;
    consent.vendorConsents = vendorConsents;
    consent.metadata = metadata;
    consent.consent = new ConsentString(consent.consentData);
    consent.storage = [
      new EUConsentCookie(tab, consent),
      new LocalStorageConsent(page),
      new OilCookie(tab)
    ];
    consent.storageChecks = await Promise.all(consent.storage.map((sto) => sto.exists()));
    consent.writeable = consent.storageChecks.some((v) => v);
    generateIABTelemetry(page, site, consent);
    return consent;
  } else {
    return false;
  }
}

/**
 * Generates a message summarising the consent format on this page including:
 *  - the site the consent was gathered on
 *  - if we were able to write the consent on this site
 *  - cmpId
 *  - a sanitised version of the consent cookie
 *  - names of cookies used (if the consent cookie is stored directly)
 *  - whether consent is stored in local storage
 *  - whether consent is stored with oil under the oil_data cookie
 * @param {*} site
 * @param {*} consent
 */
async function generateIABTelemetry(page, site, consent) {
  // check if we already sent telemetry for this site
  const telemetrySentSites = (await browser.runtime.getBackgroundPage()).telemetrySentSites;
  if (telemetrySentSites.has(site)) {
    return;
  }
  const consentString = new ConsentString(consent.consentData);
  // scrub dates - this will prevent the consent string becoming a user identifer
  consentString.created = new Date();
  await addVendorList(page, consentString);
  const payload = {
    site,
    writeable: consent.writeable,
    cmpId: consent.consent.cmpId,
    consentData: consentString.getConsentString(),
    eucookie: consent.storage[0].cookies.map(c => ({
      name: c.name,
      domain: c.domain,
      path: c.path
    })),
    lso: consent.storageChecks[1] === true ? lso.key : false,
    oil: consent.storage[2].cookie ? {
      name: consent.storage[2].cookie.name,
      domain: consent.storage[2].cookie.domain,
      path: consent.storage[2].cookie.path
    } : false,
  }
  sendAnonymousTelemetry({
    action: 'consentric.iab',
    payload,
  });
  telemetrySentSites.add(site);
}

class ConsentButton extends Component {

  render() {
    const { active, children, onClick } = this.props;
    let style = 'btn';
    if (active) {
      style += ' btn-primary';
    }
    return <button type="button" className={style} onClick={onClick}>{children}</button>
  }
}

export class IABConsentCategoryList extends Component {

  render() {
    const { purposes, onChange, readOnly } = this.props;
    const allowedPurposes = purposes || [];
    const onClick = (action, purposeId) => {
      if (readOnly) {
        return;
      }
      if (action === 'in' && allowedPurposes.indexOf(purposeId) === -1) {
        allowedPurposes.push(purposeId);
        onChange(allowedPurposes);
      } else if (action === 'out' && allowedPurposes.indexOf(purposeId) !== -1) {
        const ind = allowedPurposes.indexOf(purposeId);
        allowedPurposes.splice(ind, 1);
        onChange(allowedPurposes);
      }
    }
    const listItems = Object.keys(PURPOSES).map(id => {
      const purposeId = Number(id)
      const allowed = allowedPurposes.indexOf(purposeId) > -1;
      return (<div className="list-group-item" key={purposeId}>
        <h5>{PURPOSES[purposeId]}</h5>
        <div className="btn-group" role="group">
          <ConsentButton active={allowed} onClick={onClick.bind(undefined, 'in', purposeId)}>Opt-In</ConsentButton>
          <ConsentButton active={!allowed} onClick={onClick.bind(undefined, 'out', purposeId)}>Opt-Out</ConsentButton>
        </div>
      </div>)
    });
    return (
      <div className="list-group">
        {listItems}
      </div>
    )
  }
}

export class ConsentAllButtons extends Component {

  render() {
    const { purposeConsents, onChange, readOnly } = this.props;
    const onClick = (action) => {
      if (readOnly) {
        return;
      }
      if (action === 'out') {
        onChange([]);
      } else {
        onChange(Object.keys(purposeConsents).map(Number));
      }
    };

    return (
      <div className="btn-toolbar p-3 mx-auto">
        <div className="btn-group" role="group">
          <ConsentButton active={false} onClick={onClick.bind(undefined, 'in')}>Opt-In to all</ConsentButton>
          <ConsentButton active={false} onClick={onClick.bind(undefined, 'out')}>Opt-Out of all</ConsentButton>
        </div>
      </div>
    )
  }
}

export class ReadOnlyWarning extends Component {
  render() {
    return (
      <div className="alert alert-warning" role="alert">
        <p>No consent cookie found, cannot update consent settings.</p>
      </div>
    )
  }
}

export class IABConsent extends Component {

  async onChange(allowed) {
    const { consent, tab, site } = this.props;
    const consentData = new ConsentString(consent.consentData);
    consentData.setPurposesAllowed(allowed);
    await setConsentCookie(tab, consent, consentData);
    allowed.forEach((purpose) => {
      consent.purposeConsents[purpose] = true;
    });
    this.setState({ consent, tab });
    browser.tabs.reload(tab.id);
    sendTelemetry({
      site,
      allowed: allowed.length,
    }, 'metrics.consentric.iab.changed');
  }

  render() {
    const { consent, consentData, purposeConsents, gdprApplies, writeable } = this.props.consent;
    console.log('getVendorConsents', this.props.consent);
    console.log('consentCookieData', consent);
    const allowedPurposes = Object.keys(purposeConsents || {})
      .filter(k => purposeConsents[k])
      .reduce((l, v) => [...l, parseInt(v)], []);
    return (
      <div className="row">
        <div className="col-sm">
          <p>GDPR Applies? {gdprApplies ? 'Yes' : 'No'}</p>
          { !writeable ? <ReadOnlyWarning tab={this.props.tab}/> : null }
          <IABConsentCategoryList
            purposes={allowedPurposes}
            onChange={this.onChange.bind(this)}
            readOnly={!writeable}
          />
          <ConsentAllButtons
            purposeConsents={purposeConsents}
            onChange={this.onChange.bind(this)}
            readOnly={!writeable}
          />
        </div>
        <div className="col-sm">
          <small>Obtained {moment(consent.created).fromNow()}, updated {moment(consent.lastUpdated).fromNow()}</small>
          <p>
            <a href="https://advertisingconsent.eu/cmp-list/" target="_blank">CMP ID</a>: {consent.cmpId}
          </p>
        </div>
      </div>
    )
  }
}