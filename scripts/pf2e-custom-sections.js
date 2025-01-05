import { libWrapper } from "./libwrapper-shim.js";
const MODULE_NAME = "pf2e-custom-sections";


/////////////////////////////////
// PC SHEET DATA MODIFICATIONS
/////////////////////////////////

Hooks.once("ready", () => {
   libWrapper.register(
        MODULE_NAME,
        `CONFIG.Actor.sheetClasses.character['pf2e.CharacterSheetPF2e'].cls.prototype.getData`,
        addCustomSectionsToData,
        "WRAPPER"
    );
});

async function addCustomSectionsToData(wrapped, options){
    const data = (await wrapped(options));
    const actor = (await game.actors.get(data.actor._id));
    let newActionsData = JSON.parse(JSON.stringify(data.actions)); //we want a copy, just to be safe
 
    // Split encounter actions
    const actionData = splitActions(data.actions.encounter.action.actions, actor);
    const reactionData = splitActions(data.actions.encounter.reaction.actions, actor);
    const freeData = splitActions(data.actions.encounter.free.actions, actor);
    
    // Combine actions with custom sections into one array
    const encounterActionsWithCustomSections = [
        ...actionData.withCustomSections,
        ...reactionData.withCustomSections,
        ... freeData.withCustomSections
    ];
    
    // Update default actions lists
    newActionsData.encounter.action.actions = actionData.withoutCustomSections;
    newActionsData.encounter.reaction.actions = reactionData.withoutCustomSections;
    newActionsData.encounter.free.actions = freeData.withoutCustomSections;
    
    // Add new actions sections
    const newEncounterSections = createSectionData(encounterActionsWithCustomSections, actor);
    for(var i = 0; i < newEncounterSections.length; i++){
        const sectionName = newEncounterSections[i].label;
        const sectionId = MODULE_NAME + '-' + slugify(sectionName);
        newActionsData.encounter[sectionId] = newEncounterSections[i];
    }

    // Return updated data
    data.actions = newActionsData;
    return data;
}

function splitActions(actionsToSplit, actor){
    // Get actions with custom section flags
    const actionsWithCustomSections = actionsToSplit.filter( action => {
        const itemId = action.id;
        const item = actor.items.get(itemId);
        const sectionName = item.getFlag(MODULE_NAME, 'customSection');
        if(sectionName) return action;
    });
    
    // Get actions that aren't part of the previous array
    const actionsWithoutCustomSections = actionsToSplit.filter( action => !actionsWithCustomSections.includes(action) );
    
    return {
        withCustomSections: actionsWithCustomSections,
        withoutCustomSections: actionsWithoutCustomSections
    };
}

function createSectionData (actions, actor){
    let sections = [];
    for(var i = 0; i < actions.length; i++){
        const action =  actions[i];         
        const itemId = action.id;
        const item = actor.items.get(itemId);
        const sectionName = item.getFlag(MODULE_NAME, 'customSection');

        // If the section doesn't already exist, create it
        let sectionIndex = sections.findIndex(s => s.label === sectionName);          
        if(sectionIndex === -1){
            sections.push({ label: sectionName, actions:[], isPf2eCustomSection:true });
            sectionIndex = sections.length - 1;
        }

        // Add the action to the section
        sections[sectionIndex].actions.push(action) ;      
    }
    return sections;
}

/////////////////////////////////
// PC SHEET MODIFICATIONS
/////////////////////////////////

Hooks.on(`renderCharacterSheetPF2e`, (app, html, data) => {    
    addClassesToHeaders(app, html, data);
});

function addClassesToHeaders (app, html, data) {
    // Get list of custom section labels
    let customSectionLabels = [];
    const encounterSections = data.actions.encounter;
    for(const property in encounterSections){
        const section = encounterSections[property];
        if(section.isPf2eCustomSection){
            customSectionLabels.push(section.label)
        }
    }

    // Get list of headers in encounter panel
    const actionPanels = html.find('.actions-panel');
    const encounterPanel = actionPanels.filter('[data-tab="encounter"]');
    const headers = encounterPanel.find('header');

    // Manipulate the custom section headers
    for(var i = 0; i < headers.length; i++){
        const header = headers[i];
        const label = header.innerText.trim(" ").split("\n")[0];

        if(customSectionLabels.includes(label)){
            // Assign class to header element
            $(header).addClass('pf2e-custom-section');

            // Remove controls
            $(header).children('.controls').remove();

            // Inject indicator tag in place of buttons
            const customTag = $("<div class='custom-section-tag'>Custom Section</div>");
            $(header).append(customTag);
        }
    } 
}


/////////////////////////////////
// ITEM SHEET MODIFICATIONS
/////////////////////////////////

Hooks.on(`renderFeatSheetPF2e`, (app, html, data) => {    
    addCustomSectionField(app, html, data);
});

Hooks.on(`renderAbilitySheetPF2e`, (app, html, data) => {    
    addCustomSectionField(app, html, data);
});

async function addCustomSectionField(app, html, data) {
    // Skip this item if parent is not a character type actor
    if (data.item?.parent?.type != "character") return;

    // Skip this item if it's a downtime or exploration activity
    const excludedTraits = ['exploration', 'downtime'];
    const itemTraits = data.data.traits.value || [];
    const itemHasForbiddenTraits = itemTraits.some( t => excludedTraits.includes(t) );
    if(itemHasForbiddenTraits) return;

    // Inject content into to the sheet sidebar
    let sidebar = html.find('.inventory-details');
    let sectionInput = $(await renderTemplate('modules/pf2e-custom-sections/templates/feat-sheet-input.hbs', data.item.flags[MODULE_NAME]))
    sidebar.append(sectionInput);
    activateTabListeners(html, data);   
}

function activateTabListeners(html, data){
    const item = data.item;
    html.find('#pf2e-custom-sections-name').change(async (ev) => {
        const newSectionName = ev.target.value;
        if(newSectionName){
            await item.setFlag(MODULE_NAME, "customSection", newSectionName);
        } else {
            await item.unsetFlag(MODULE_NAME, "customSection");
        }
        
    }); 
}

/////////////////////////////////
// ITEM UPDATE MODIFICATIONS
/////////////////////////////////

Hooks.on(`preUpdateItem`, (item, change, options, userId) => {  
    if(!change.flags) return; 
    if(!change.flags[MODULE_NAME]) return;
    const newSectionName = change.flags[MODULE_NAME].customSection;
    if(!newSectionName) return;

    // Pull labels we shouldn't use - Attacks / Actions / Reactions / Free Actions
    const restrictedSectionLabels = [
        game.i18n.localize("PF2E.Actor.Attacks"),
        game.i18n.localize("PF2E.ActionsActionsHeader"),
        game.i18n.localize("PF2E.ActionsFreeActionsHeader"),
        game.i18n.localize("PF2E.ActionsReactionsHeader")
    ];

    if(restrictedSectionLabels.includes(newSectionName)){
        ui.notifications.error(`Section name ${newSectionName} already in use by system. Please choose another.`);
        return false;
    }
});

/////////////////////////////////
// UTILITY METHODS
/////////////////////////////////

function slugify(str) {
    str = str.replace(/^\s+|\s+$/g, ''); // trim leading/trailing white space
    str = str.toLowerCase(); // convert string to lowercase
    str = str.replace(/[^a-z0-9 -]/g, '') // remove any non-alphanumeric characters
             .replace(/\s+/g, '-') // replace spaces with hyphens
             .replace(/-+/g, '-'); // remove consecutive hyphens
    return str;
}






